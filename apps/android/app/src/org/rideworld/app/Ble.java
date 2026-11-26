package org.rideworld.app;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Base64;
import android.util.Log;
import android.widget.ArrayAdapter;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Web Bluetooth's job, done natively for the page (public/js/android-bridge.js builds navigator.bluetooth on top):
 * a device picker filtered by service, GATT connect + service discovery, read / write / notifications, devices chosen
 * before (remembered here, so the site's "reconnect my devices" finds them with no picker) and watching for a
 * remembered device to advertise. Android allows one GATT operation at a time per connection: each has a queue.
 */
@SuppressLint("MissingPermission") // (asked for at start: MainActivity.askPermissions; every entry point checks)
class Ble {
    static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    final MainActivity act;
    final Handler main = new Handler(Looper.getMainLooper());
    final Map<String, Conn> conns = new HashMap<>();
    final Map<String, ScanCallback> watchers = new HashMap<>();
    final SharedPreferences prefs;

    Ble(MainActivity a) { act = a; prefs = a.getSharedPreferences("ble", Context.MODE_PRIVATE); }

    BluetoothAdapter adapter() { BluetoothManager m = (BluetoothManager) act.getSystemService(Context.BLUETOOTH_SERVICE); return m == null ? null : m.getAdapter(); }

    // ---- answers to the page ----
    void ok(int id, Object value) { act.js("window.__rwb&&__rwb.r(" + id + ",true," + (value == null ? "null" : value instanceof String ? JSONObject.quote((String) value) : value.toString()) + ")"); }
    void fail(int id, String name, String msg) { act.js("window.__rwb&&__rwb.r(" + id + ",false," + JSONObject.quote(name + ": " + msg) + ")"); }
    void event(JSONObject e) { act.js("window.__rwb&&__rwb.ev(" + e + ")"); }

    boolean ready(int id) {
        BluetoothAdapter a = adapter();
        if (a == null) { fail(id, "NotSupportedError", "This device has no Bluetooth"); return false; }
        if (!act.hasBlePermissions()) { act.runOnUiThread(act::askPermissions); fail(id, "SecurityError", "RideWorld needs the Nearby devices permission for Bluetooth (allow it, then try again)"); return false; }
        if (!a.isEnabled()) { fail(id, "NetworkError", "Bluetooth is switched off"); return false; }
        return true;
    }

    // ---- remembered devices ----
    JSONObject remembered() { try { return new JSONObject(prefs.getString("devices", "{}")); } catch (Exception e) { return new JSONObject(); } }
    void remember(String addr, String name) { try { JSONObject o = remembered(); o.put(addr, name == null ? "" : name); prefs.edit().putString("devices", o.toString()).apply(); } catch (Exception ignored) {} }
    void forget(String addr) { JSONObject o = remembered(); o.remove(addr); prefs.edit().putString("devices", o.toString()).apply(); }
    void devices(int id) {
        try {
            JSONArray out = new JSONArray(); JSONObject o = remembered();
            for (java.util.Iterator<String> it = o.keys(); it.hasNext();) { String k = it.next(); out.put(new JSONObject().put("id", k).put("name", o.optString(k))); }
            ok(id, out);
        } catch (Exception e) { fail(id, "UnknownError", String.valueOf(e)); }
    }

    // ---- the picker: scan for devices offering any of the services, list them as they appear ----
    void request(int id, String servicesJson) {
        if (!ready(id)) return;
        act.runOnUiThread(() -> {
            List<ScanFilter> filters = new ArrayList<>();
            try { JSONArray a = new JSONArray(servicesJson); for (int i = 0; i < a.length(); i++) filters.add(new ScanFilter.Builder().setServiceUuid(ParcelUuid.fromString(a.getString(i))).build()); } catch (Exception e) { fail(id, "TypeError", "bad services"); return; }
            BluetoothLeScanner sc = adapter().getBluetoothLeScanner();
            if (sc == null) { fail(id, "NetworkError", "Bluetooth is switched off"); return; }
            final LinkedHashMap<String, String> found = new LinkedHashMap<>();
            final ArrayList<String> rows = new ArrayList<>();
            final ArrayAdapter<String> list = new ArrayAdapter<>(act, android.R.layout.simple_list_item_1, rows);
            final boolean[] done = { false };
            final ScanCallback cb = new ScanCallback() {
                @Override public void onScanResult(int type, ScanResult r) {
                    String addr = r.getDevice().getAddress(); if (found.containsKey(addr)) return;
                    String name = r.getScanRecord() != null && r.getScanRecord().getDeviceName() != null ? r.getScanRecord().getDeviceName() : r.getDevice().getName();
                    found.put(addr, name == null ? "" : name);
                    rows.add((name == null || name.isEmpty() ? "Unnamed device" : name) + "  (" + addr.substring(addr.length() - 5) + ")");
                    list.notifyDataSetChanged();
                }
            };
            final AlertDialog[] dlg = new AlertDialog[1];
            dlg[0] = new AlertDialog.Builder(act)
                    .setTitle("Pedal or wake your sensor…")
                    .setAdapter(list, (d, which) -> {
                        done[0] = true; sc.stopScan(cb);
                        String addr = new ArrayList<>(found.keySet()).get(which), name = found.get(addr);
                        remember(addr, name);
                        try { ok(id, new JSONObject().put("id", addr).put("name", name)); } catch (Exception e) { fail(id, "UnknownError", String.valueOf(e)); }
                    })
                    .setNegativeButton("Cancel", (d, w) -> {})
                    .setOnDismissListener((d) -> { if (!done[0]) { done[0] = true; try { sc.stopScan(cb); } catch (Exception ignored) {} fail(id, "NotFoundError", "User cancelled the requestDevice() chooser."); } })
                    .create();
            dlg[0].show();
            sc.startScan(filters, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), cb);
        });
    }

    // ---- a remembered device advertising (the site reconnects when it hears it) ----
    void watch(String addr, boolean on) {
        act.runOnUiThread(() -> {
            BluetoothAdapter a = adapter(); if (a == null || !a.isEnabled() || !act.hasBlePermissions()) return;
            BluetoothLeScanner sc = a.getBluetoothLeScanner(); if (sc == null) return;
            ScanCallback old = watchers.remove(addr); if (old != null) try { sc.stopScan(old); } catch (Exception ignored) {}
            if (!on) return;
            ScanCallback cb = new ScanCallback() {
                long last = 0;
                @Override public void onScanResult(int type, ScanResult r) {
                    long now = System.currentTimeMillis(); if (now - last < 1000) return; last = now;
                    try { event(new JSONObject().put("t", "adv").put("d", addr).put("rssi", r.getRssi())); } catch (Exception ignored) {}
                }
            };
            watchers.put(addr, cb);
            List<ScanFilter> f = new ArrayList<>(); f.add(new ScanFilter.Builder().setDeviceAddress(addr).build());
            sc.startScan(f, new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED).build(), cb);
        });
    }

    // ---- connections ----
    class Conn extends BluetoothGattCallback {
        final String addr; BluetoothGatt gatt; int connectId; boolean up;
        final ArrayDeque<Runnable> queue = new ArrayDeque<>(); boolean busy; int opId; Runnable timeout;
        Conn(String a) { addr = a; }

        void run(Runnable op) { synchronized (this) { queue.add(op); } next(); }
        void next() {
            Runnable r;
            synchronized (this) { if (busy || queue.isEmpty()) return; busy = true; r = queue.poll(); }
            main.post(r);
        }
        void finish() { synchronized (this) { busy = false; } if (timeout != null) main.removeCallbacks(timeout); next(); }
        void arm(int id) { opId = id; timeout = () -> { fail(id, "NetworkError", "Bluetooth operation timed out"); finish(); }; main.postDelayed(timeout, 6000); }

        BluetoothGattCharacteristic ch(String svc, String chr) {
            BluetoothGattService s = gatt == null ? null : gatt.getService(UUID.fromString(svc));
            return s == null ? null : s.getCharacteristic(UUID.fromString(chr));
        }

        @Override public void onConnectionStateChange(BluetoothGatt g, int status, int state) {
            if (state == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                main.post(() -> { g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH); g.discoverServices(); });
                return;
            }
            boolean wasUp = up; up = false;
            synchronized (this) { queue.clear(); busy = false; }
            g.close(); conns.remove(addr);
            if (connectId != 0) { fail(connectId, "NetworkError", "Connection failed (" + status + ")"); connectId = 0; }
            if (wasUp) try { event(new JSONObject().put("t", "disc").put("d", addr)); } catch (Exception ignored) {}
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (connectId == 0) return;
            try {
                JSONArray svcs = new JSONArray();
                for (BluetoothGattService s : g.getServices()) {
                    JSONArray chars = new JSONArray();
                    for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                        int p = c.getProperties();
                        chars.put(new JSONObject().put("uuid", c.getUuid().toString())
                                .put("read", (p & BluetoothGattCharacteristic.PROPERTY_READ) != 0)
                                .put("write", (p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0)
                                .put("writeWithoutResponse", (p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
                                .put("notify", (p & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0)
                                .put("indicate", (p & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0));
                    }
                    svcs.put(new JSONObject().put("uuid", s.getUuid().toString()).put("chars", chars));
                }
                up = true; int id = connectId; connectId = 0; ok(id, svcs);
            } catch (Exception e) { fail(connectId, "UnknownError", String.valueOf(e)); connectId = 0; }
        }

        // reads (Android 13+ hands the value; older ones keep it on the characteristic)
        @Override public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value, int status) { readDone(value, status); }
        @SuppressWarnings("deprecation") @Override public void onCharacteristicRead(BluetoothGatt g, BluetoothGattCharacteristic c, int status) { readDone(c.getValue(), status); }
        void readDone(byte[] v, int status) { if (status == BluetoothGatt.GATT_SUCCESS) ok(opId, b64(v)); else fail(opId, "NotSupportedError", "read failed (" + status + ")"); finish(); }

        @Override public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) { if (status == BluetoothGatt.GATT_SUCCESS) ok(opId, null); else fail(opId, "NotSupportedError", "write failed (" + status + ")"); finish(); }
        @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) { if (status == BluetoothGatt.GATT_SUCCESS) ok(opId, null); else fail(opId, "NotSupportedError", "notifications failed (" + status + ")"); finish(); }

        // notifications
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] value) { changed(c, value); }
        @SuppressWarnings("deprecation") @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) { if (Build.VERSION.SDK_INT < 33) changed(c, c.getValue()); }
        void changed(BluetoothGattCharacteristic c, byte[] v) {
            try { event(new JSONObject().put("t", "val").put("d", addr).put("s", c.getService().getUuid().toString()).put("c", c.getUuid().toString()).put("v", b64(v))); } catch (Exception ignored) {}
        }
    }

    static String b64(byte[] v) { return v == null ? "" : Base64.encodeToString(v, Base64.NO_WRAP); }

    void connect(int id, String addr) {
        if (!ready(id)) return;
        main.post(() -> {
            Conn c = conns.get(addr);
            if (c != null && c.up) { c.connectId = id; c.gatt.discoverServices(); return; }
            if (c != null) { try { c.gatt.close(); } catch (Exception ignored) {} conns.remove(addr); }
            BluetoothDevice dev;
            try { dev = adapter().getRemoteDevice(addr); } catch (Exception e) { fail(id, "NotFoundError", "Unknown device"); return; }
            c = new Conn(addr); c.connectId = id; conns.put(addr, c);
            c.gatt = dev.connectGatt(act, false, c, BluetoothDevice.TRANSPORT_LE);
            final Conn cc = c;
            main.postDelayed(() -> { if (cc.connectId == id) { cc.connectId = 0; try { cc.gatt.close(); } catch (Exception ignored) {} conns.remove(addr); fail(id, "NetworkError", "Connection timed out"); } }, 15000);
        });
    }
    void disconnect(String addr) { main.post(() -> { Conn c = conns.remove(addr); if (c != null) { c.up = false; try { c.gatt.disconnect(); c.gatt.close(); } catch (Exception ignored) {} } }); }
    void closeAll() { for (String a : new ArrayList<>(conns.keySet())) disconnect(a); for (String a : new ArrayList<>(watchers.keySet())) watch(a, false); }

    Conn live(int id, String addr) { Conn c = conns.get(addr); if (c == null || !c.up) { fail(id, "NetworkError", "GATT Server is disconnected."); return null; } return c; }

    void read(int id, String addr, String svc, String chr) {
        Conn c = live(id, addr); if (c == null) return;
        c.run(() -> { BluetoothGattCharacteristic ch = c.ch(svc, chr); if (ch == null) { fail(id, "NotFoundError", "No such characteristic"); c.finish(); return; } c.arm(id); if (!c.gatt.readCharacteristic(ch)) { fail(id, "NetworkError", "read refused"); c.finish(); } });
    }

    @SuppressWarnings("deprecation")
    void write(int id, String addr, String svc, String chr, String b64v, boolean withResponse) {
        Conn c = live(id, addr); if (c == null) return;
        byte[] v = Base64.decode(b64v, Base64.DEFAULT);
        c.run(() -> {
            BluetoothGattCharacteristic ch = c.ch(svc, chr); if (ch == null) { fail(id, "NotFoundError", "No such characteristic"); c.finish(); return; }
            int type = withResponse ? BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT : BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE;
            c.arm(id);
            boolean sent;
            if (Build.VERSION.SDK_INT >= 33) sent = c.gatt.writeCharacteristic(ch, v, type) == BluetoothGatt.GATT_SUCCESS;
            else { ch.setWriteType(type); ch.setValue(v); sent = c.gatt.writeCharacteristic(ch); }
            if (!sent) { fail(id, "NetworkError", "write refused"); c.finish(); }
        });
    }

    @SuppressWarnings("deprecation")
    void notify(int id, String addr, String svc, String chr, boolean on) {
        Conn c = live(id, addr); if (c == null) return;
        c.run(() -> {
            BluetoothGattCharacteristic ch = c.ch(svc, chr); if (ch == null) { fail(id, "NotFoundError", "No such characteristic"); c.finish(); return; }
            BluetoothGattDescriptor d = ch.getDescriptor(CCCD);
            if (!c.gatt.setCharacteristicNotification(ch, on) || d == null) { if (d == null && on) ok(id, null); else fail(id, "NotSupportedError", "notifications refused"); c.finish(); return; }
            boolean indicate = (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0 && (ch.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0;
            byte[] v = !on ? BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE : indicate ? BluetoothGattDescriptor.ENABLE_INDICATION_VALUE : BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
            c.arm(id);
            boolean sent;
            if (Build.VERSION.SDK_INT >= 33) sent = c.gatt.writeDescriptor(d, v) == BluetoothGatt.GATT_SUCCESS;
            else { d.setValue(v); sent = c.gatt.writeDescriptor(d); }
            if (!sent) { fail(id, "NetworkError", "notifications refused"); c.finish(); }
        });
    }
}
