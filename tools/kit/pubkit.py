# Pub kit for RideWorld's Bromsgrove landmarks (2026-11-22, the owner: "most pubs, really ... it sticks out like a sore thumb
# when they're a generic box"). Shared by tools/kit/bromsgrove.py's pub models, on top of tools/kit/london/lk.py.
#   Frame(A, B, D)       a building's own axes: u along the front from corner A towards B, v from the front (A) back
#                        towards D; T(u, v) -> world metres; every helper below works in (u, v, z)
#   Elev(w, h, base)     an elevation painted to measure (metres; z up from the ground): windows, doors, timbers, brick
#                        panels, boards; .material(name) packs it. Mapped once onto a wall face with Frame.face / .tri,
#                        so a window drawn 1.2 m from the left IS 1.2 m from the corner on the model
# Textures stay small (24 px a metre): the models are built with LK_MAX=256 for the laptops' graphics memory.
import math
import numpy as np
import bpy, bmesh
from mathutils import Matrix
import lk

PPM = 24  # pixels a metre for painted elevations

class Elev:
    def __init__(self, w, h, base, ppm=PPM, grain=0.03):
        self.w, self.h, self.ppm = w, h, ppm
        W = max(8, int(round(w * ppm / 4)) * 4); H = max(8, int(round(h * ppm / 4)) * 4)
        self.W, self.H = W, H
        self.img = np.ones((H, W, 3), np.float32) * np.array(base, np.float32) * (1 + lk.noise(H, W, grain, 1))
    def _c(self, x, z): return int(round(x / self.w * self.W)), int(round(self.H - z / self.h * self.H))
    def fill(self, x0, z0, x1, z1, col, grain=0.0):
        c0, r1 = self._c(x0, z0); c1, r0 = self._c(x1, z1)
        c0, c1 = max(0, min(c0, c1)), min(self.W, max(c0, c1)); r0, r1 = max(0, min(r0, r1)), min(self.H, max(r0, r1))
        if c1 <= c0 or r1 <= r0: return
        blk = np.ones((r1 - r0, c1 - c0, 3), np.float32) * np.array(col, np.float32)
        if grain: blk *= 1 + lk.noise(r1 - r0, c1 - c0, grain, 0)
        self.img[r0:r1, c0:c1] = blk
    def brick(self, x0, z0, x1, z1, col=(0.52, 0.24, 0.17), mortar=(0.66, 0.6, 0.55)):
        """a brick panel: courses every 7.5 cm (thin mortar lines every few pixels), bricks varying a little"""
        self.fill(x0, z0, x1, z1, col, grain=0.08)
        c0, r1 = self._c(x0, z0); c1, r0 = self._c(x1, z1)
        step = max(2, int(round(0.075 * 2 * self.H / self.h)))
        for r in range(max(0, r0), min(self.H, r1), step): self.img[r, max(0, c0):min(self.W, c1)] = np.array(mortar) * 0.9 + self.img[r, max(0, c0):min(self.W, c1)] * 0.1
    def window(self, x0, z0, w, h, cols=2, rows=2, frame=(0.95, 0.95, 0.93), glass=(0.13, 0.16, 0.2), fw=0.07, sill=None, arch=False):
        """a window: frame colour, glazing bars dividing it into cols x rows panes (darker towards the top: reflections)"""
        self.fill(x0 - fw, z0 - fw, x0 + w + fw, z0 + h + fw, frame)
        pw, ph = (w - fw * (cols - 1)) / cols, (h - fw * (rows - 1)) / rows
        for i in range(cols):
            for j in range(rows):
                px, pz = x0 + i * (pw + fw), z0 + j * (ph + fw)
                g = np.array(glass) * (0.85 + 0.3 * (j + 0.5) / rows)
                self.fill(px, pz, px + pw, pz + ph, g)
        if arch:  # a segmental head: frame-coloured arc filled over the top
            r = w / 2; cx = x0 + w / 2
            for k in range(12):
                a = math.pi * k / 11; self.fill(cx + math.cos(a) * r - 0.06, z0 + h + math.sin(a) * r * 0.5 - 0.06, cx + math.cos(a) * r + 0.06, z0 + h + math.sin(a) * r * 0.5 + 0.06, frame)
        if sill: self.fill(x0 - fw - 0.08, z0 - fw - 0.1, x0 + w + fw + 0.08, z0 - fw, sill)
    def door(self, x0, w, h, col=(0.1, 0.1, 0.11), z0=0.0, frame=None, glazed=False):
        if frame: self.fill(x0 - 0.1, z0, x0 + w + 0.1, z0 + h + 0.1, frame)
        self.fill(x0, z0, x0 + w, z0 + h, col, grain=0.03)
        if glazed: self.fill(x0 + 0.12, z0 + h * 0.55, x0 + w - 0.12, z0 + h - 0.12, (0.13, 0.16, 0.2))
        else:
            for k in (0.25, 0.6): self.fill(x0 + 0.12, z0 + h * k, x0 + w - 0.12, z0 + h * k + h * 0.28, np.array(col) * 1.25)
    def line(self, x0, z0, x1, z1, wd, col):
        """a straight timber (or any stripe) wd metres wide"""
        L = math.hypot(x1 - x0, z1 - z0); n = max(2, int(L * self.ppm * 1.5))
        for k in range(n + 1):
            t = k / n; x, z = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            self.fill(x - wd / 2, z - wd / 2, x + wd / 2, z + wd / 2, col)
    def ring(self, cx, cz, r, wd, col):
        n = max(40, int(2 * math.pi * r * self.ppm * 1.5))   # (enough points that a big circle stays unbroken)
        for k in range(n):
            a = 2 * math.pi * k / n; x, z = cx + math.cos(a) * r, cz + math.sin(a) * r
            self.fill(x - wd / 2, z - wd / 2, x + wd / 2, z + wd / 2, col)
    def board(self, x0, z0, w, h, col, edge=None):
        if edge: self.fill(x0 - 0.05, z0 - 0.05, x0 + w + 0.05, z0 + h + 0.05, edge)
        self.fill(x0, z0, x0 + w, z0 + h, col)
    def material(self, name, rough=0.85, glow=0.22):
        return lk.mat(name, img=lk.image(name, np.clip(self.img, 0, 1)), rough=rough, glow=glow)

class Frame:
    def __init__(self, A, B, D):
        self.A = A
        Lu = math.hypot(B[0] - A[0], B[1] - A[1]); self.U = ((B[0] - A[0]) / Lu, (B[1] - A[1]) / Lu); self.Lu = Lu
        Lv = math.hypot(D[0] - A[0], D[1] - A[1]); self.V = ((D[0] - A[0]) / Lv, (D[1] - A[1]) / Lv); self.Lv = Lv
        self.ang = math.atan2(self.U[1], self.U[0])
    def T(self, u, v): return (self.A[0] + u * self.U[0] + v * self.V[0], self.A[1] + u * self.U[1] + v * self.V[1])
    def R(self, pts): return [self.T(u, v) for u, v in pts]
    def rect(self, u0, u1, v0, v1): return self.R([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    def block(self, name, u0, u1, v0, v1, z0, z1, mat, uv=3.0, uvz=None):
        return lk.prism(name, self.rect(u0, u1, v0, v1), z0, z1, mat, uv=uv, uvz=uvz, bottom=True)
    def box(self, name, u, v, z0, wu, dv, h, mat):
        c = self.T(u, v); return lk.box(name, c[0], c[1], z0, wu, dv, h, mat, rot=self.ang)
    def _uvface(self, name, pts, uvs, mat):
        bm = bmesh.new(); vs = [bm.verts.new(p) for p in pts]; f = bm.faces.new(vs); lay = bm.loops.layers.uv.verify()
        for l, t in zip(f.loops, uvs): l[lay].uv = t
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(mat); lk.objs.append(o)
        return o
    def face(self, name, mat, u0, u1, z0, z1, v=0.0, out=-1, back=False):
        """a painted elevation over a wall running along u at depth v, facing -v (out=-1, the front) or +v; a little proud of it"""
        d = 0.02 * out
        a, b = self.T(u0, v + d), self.T(u1, v + d)
        pts = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]; uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        if out > 0: pts = [pts[1], pts[0], pts[3], pts[2]]; uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        return self._uvface(name, pts, uvs, mat)
    def side(self, name, mat, v0, v1, z0, z1, u, out=1):
        """a painted elevation over an end wall running along v at u, facing +u (out=1) or -u; left of the picture = v0 seen from outside"""
        d = 0.02 * out
        a, b = self.T(u + d, v0), self.T(u + d, v1)
        pts = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
        if out < 0: pts = [pts[1], pts[0], pts[3], pts[2]]
        return self._uvface(name, pts, [(0, 0), (1, 0), (1, 1), (0, 1)], mat)
    def tri(self, name, mat, u0, u1, z0, rise, v=0.0, out=-1, along='u'):
        """a gable triangle (base from u0 to u1 at height z0, apex rise above its middle), painted: the picture's bottom edge
        along the base, its top middle at the apex. along='v': the triangle stands across v at u = v (an end gable)"""
        d = 0.02 * out
        if along == 'u': a, b, c = self.T(u0, v + d), self.T(u1, v + d), self.T((u0 + u1) / 2, v + d)
        else: a, b, c = self.T(v + d, u0), self.T(v + d, u1), self.T(v + d, (u0 + u1) / 2)
        pts = [(a[0], a[1], z0), (b[0], b[1], z0), (c[0], c[1], z0 + rise)]; uvs = [(0, 0), (1, 0), (0.5, 1)]
        flip = (out > 0) if along == 'u' else (out < 0)
        if flip: pts = [pts[1], pts[0], pts[2]]; uvs = [(0, 0), (1, 0), (0.5, 1)]
        return self._uvface(name, pts, uvs, mat)
    def gable_roof(self, name, u0, u1, v0, v1, eave, rise, mat, ridge='u', over=0.3, thick=0.12):
        """a pitched roof over the rectangle, ridge along u or v, eaves overhanging `over`, as a closed solid (a slab thick)"""
        bm = bmesh.new()
        def V(u, v, z): return bm.verts.new((*self.T(u, v), z))
        if ridge == 'u':
            uu0, uu1, vv0, vv1 = u0 - over * 0.6, u1 + over * 0.6, v0 - over, v1 + over
            m = (v0 + v1) / 2; sl = rise / ((v1 - v0) / 2); e0 = eave - over * sl
            top = [V(uu0, vv0, e0), V(uu1, vv0, e0), V(uu1, m, eave + rise), V(uu0, m, eave + rise)]
            top2 = [V(uu0, m, eave + rise), V(uu1, m, eave + rise), V(uu1, vv1, e0), V(uu0, vv1, e0)]
        else:
            uu0, uu1, vv0, vv1 = u0 - over, u1 + over, v0 - over * 0.6, v1 + over * 0.6
            m = (u0 + u1) / 2; sl = rise / ((u1 - u0) / 2); e0 = eave - over * sl
            top = [V(uu0, vv0, e0), V(m, vv0, eave + rise), V(m, vv1, eave + rise), V(uu0, vv1, e0)]
            top2 = [V(m, vv0, eave + rise), V(uu1, vv0, e0), V(uu1, vv1, e0), V(m, vv1, eave + rise)]
        bmesh.ops.delete(bm, geom=[], context='VERTS')
        f1 = bm.faces.new(top); f2 = bm.faces.new(top2)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ret = bmesh.ops.extrude_face_region(bm, geom=[f1, f2])
        vs = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=vs, vec=(0, 0, -thick))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return lk.finish(name, bm, mat, 2.0)
    def hip_roof(self, name, u0, u1, v0, v1, eave, rise, mat, over=0.3):
        """a hipped roof: a ridge along the longer side, all four sides sloping"""
        du, dv = u1 - u0, v1 - v0; s = min(du, dv) / 2
        p0 = self.rect(u0 - over, u1 + over, v0 - over, v1 + over)
        if du >= dv: top = self.R([(u0 + s, v0 + s - 0.01), (u1 - s, v0 + s - 0.01), (u1 - s, v0 + s + 0.01), (u0 + s, v0 + s + 0.01)])
        else: top = self.R([(u0 + s - 0.01, v0 + s), (u0 + s + 0.01, v0 + s), (u0 + s + 0.01, v1 - s), (u0 + s - 0.01, v1 - s)])
        sl = rise / s
        return lk.taper(name, p0, eave - over * sl, top, eave + rise, mat, uv=2.0)
    def chimney(self, name, u, v, top, wu, dv, mat, pot, pots=2, base=None):
        base = top - 2.4 if base is None else base
        c = self.T(u, v); lk.box(name, c[0], c[1], base, wu, dv, top - base, mat, rot=self.ang)
        lk.box(name + 'Cap', c[0], c[1], top, wu + 0.12, dv + 0.12, 0.12, mat, rot=self.ang)
        for k in range(pots):
            t = (k - (pots - 1) / 2) * (wu / max(1, pots)); p = self.T(u + t, v)
            lk.cyl(name + 'Pot', p[0], p[1], top + 0.12, 0.13, 0.5, pot, seg=8)
    def text(self, body, size, u, v, z, mat, out=-1, extrude=0.02, along='u'):
        """lettering on a face (along u at depth v facing -v by default; along='v': on an end wall at u = v-argument)"""
        cu = bpy.data.curves.new('T', 'FONT'); cu.body = body; cu.size = size; cu.extrude = extrude; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
        o = bpy.data.objects.new('Text', cu); bpy.context.scene.collection.objects.link(o); bpy.context.view_layer.update()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get())); bpy.data.objects.remove(o)
        if along == 'u': p = self.T(u, v + out * 0.06); rot = self.ang if out < 0 else self.ang + math.pi
        else: p = self.T(v + out * 0.06, u); rot = self.ang + math.pi / 2 + (0 if out > 0 else math.pi)
        me.transform(Matrix.Translation((p[0], p[1], z)) @ Matrix.Rotation(rot, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X'))
        m2 = bpy.data.objects.new('Lettering', me); bpy.context.scene.collection.objects.link(m2); me.materials.append(mat); lk.objs.append(m2)
        return m2

def tiles(col=(0.42, 0.29, 0.23)):
    return lk.mat('Tiles' + str(col), img=lk.image('tiles%.2f' % col[0], lk.ashlar(col, rows=22, cols=9, mortar=0.72, jitter=0.08)), rough=0.85, glow=0.12)
def plain(name, col, rough=0.85, glow=0.18): return lk.mat(name, col, rough=rough, glow=glow)

def cavalier(F, u, v, name='Cavalier', coat=(0.45, 0.06, 0.08), z=0.0):
    """A standing Restoration gentleman, 1.8 m (the Black Cross's Charles II, 2026-11-22: the owner, "king Charles II stopped
    at the black cross ... a nice little easter egg might be him stood outside"): buckled shoes, white stockings, breeches,
    a long skirted coat with gold buttons and cuffs, the blue Garter sash, a lace cravat, long black curls, a broad black
    hat with a white plume, a cane in his right hand. Stands at (u, v) of frame F facing -v (out to the street)."""
    SKIN = plain(name + 'Skin', (0.86, 0.68, 0.56), glow=0.25); WIG = plain(name + 'Wig', (0.07, 0.05, 0.05), rough=0.7, glow=0.08)
    COAT = plain(name + 'Coat', coat, rough=0.7, glow=0.2); GOLDM = lk.mat(name + 'Gold', (0.9, 0.72, 0.3), rough=0.35, metal=0.7, glow=0.4)
    WHITEM = plain(name + 'Lace', (0.95, 0.94, 0.9), glow=0.3); BLK = plain(name + 'Black', (0.05, 0.05, 0.06), rough=0.5, glow=0.06)
    BREECH = plain(name + 'Breeches', (0.18, 0.06, 0.08)); BLUE = plain(name + 'Garter', (0.15, 0.3, 0.72), glow=0.3)
    P = lambda du, dv, dz: (*F.T(u + du, v + dv), z + dz)
    for s in (-1, 1):  # legs: shoes, stockings, breeches
        c = F.T(u + s * 0.1, v - 0.04); lk.box(name + 'Shoe', c[0], c[1], z, 0.11, 0.26, 0.08, BLK, rot=F.ang)
        b = F.T(u + s * 0.1, v - 0.15); lk.box(name + 'Buckle', b[0], b[1], z + 0.04, 0.07, 0.02, 0.05, GOLDM, rot=F.ang)
        c = F.T(u + s * 0.1, v); lk.cyl(name + 'Stocking', c[0], c[1], z + 0.06, 0.055, 0.46, WHITEM, seg=10, r2=0.07)
        lk.cyl(name + 'Breeches', c[0], c[1], z + 0.5, 0.085, 0.36, BREECH, seg=10, r2=0.1)
    c = F.T(u, v)
    lk.lathe(name + 'Coat', [(0.3, z + 0.5), (0.27, z + 0.8), (0.21, z + 1.05), (0.2, z + 1.3), (0.22, z + 1.42), (0.12, z + 1.5)], COAT, seg=16, cx=c[0], cy=c[1])
    lk.lathe(name + 'Hem', [(0.305, z + 0.5), (0.305, z + 0.56)], GOLDM, seg=16, cx=c[0], cy=c[1], cap_top=False)
    for k in range(6):  # buttons down the front
        b = F.T(u, v - 0.215 + k * 0.004); lk.cyl(name + 'Button', b[0], b[1], z + 0.82 + k * 0.1, 0.018, 0.02, GOLDM, seg=6)
    lk.tube(name + 'Sash', P(0.16, -0.17, 1.4), P(0.0, -0.215, 1.18), 0.04, BLUE); lk.tube(name + 'Sash2', P(0.0, -0.215, 1.18), P(-0.2, -0.24, 0.92), 0.04, BLUE)
    lk.box(name + 'Cravat', *F.T(u, v - 0.17), z + 1.33, 0.14, 0.06, 0.17, WHITEM, rot=F.ang)
    # arms: the left hanging, the right forward to the cane
    lk.tube(name + 'ArmL', P(-0.24, 0, 1.4), P(-0.3, -0.05, 0.98), 0.06, COAT); lk.tube(name + 'CuffL', P(-0.3, -0.05, 0.98), P(-0.31, -0.06, 0.9), 0.075, GOLDM)
    lk.tube(name + 'HandL', P(-0.31, -0.06, 0.9), P(-0.31, -0.07, 0.82), 0.04, SKIN)
    lk.tube(name + 'ArmR', P(0.24, 0, 1.4), P(0.33, -0.22, 1.02), 0.06, COAT); lk.tube(name + 'CuffR', P(0.33, -0.22, 1.02), P(0.35, -0.26, 0.95), 0.075, GOLDM)
    lk.tube(name + 'HandR', P(0.35, -0.26, 0.95), P(0.36, -0.28, 0.9), 0.045, SKIN)
    lk.tube(name + 'Cane', P(0.36, -0.28, 0.95), P(0.42, -0.36, 0.0), 0.012, BLK); h = P(0.36, -0.28, 0.95); lk.cyl(name + 'Knob', h[0], h[1], h[2], 0.025, 0.04, GOLDM, seg=8)
    # head, curls, moustache, hat and plume
    lk.cyl(name + 'Neck', c[0], c[1], z + 1.48, 0.05, 0.08, SKIN, seg=8)
    lk.lathe(name + 'Head', [(0.0, z + 1.55), (0.07, z + 1.57), (0.095, z + 1.64), (0.09, z + 1.71), (0.06, z + 1.77), (0.0, z + 1.79)], SKIN, seg=14, cx=c[0], cy=c[1])
    w = F.T(u, v + 0.06); lk.lathe(name + 'Wig', [(0.0, z + 1.58), (0.1, z + 1.61), (0.11, z + 1.72), (0.085, z + 1.8), (0.0, z + 1.82)], WIG, seg=14, cx=w[0], cy=w[1])
    for s in (-1, 1):
        cc = F.T(u + s * 0.115, v + 0.03); lk.cyl(name + 'Curls', cc[0], cc[1], z + 1.3, 0.06, 0.38, WIG, seg=8, r2=0.075)
    cc = F.T(u, v + 0.07); lk.cyl(name + 'CurlsBack', cc[0], cc[1], z + 1.32, 0.11, 0.36, WIG, seg=10, r2=0.12)
    m = F.T(u, v - 0.092); lk.box(name + 'Moustache', m[0], m[1], z + 1.62, 0.06, 0.01, 0.012, WIG, rot=F.ang)
    lk.cyl(name + 'Brim', c[0], c[1], z + 1.78, 0.25, 0.025, BLK, seg=16)
    lk.cyl(name + 'Crown', c[0], c[1], z + 1.8, 0.11, 0.13, BLK, seg=12, r2=0.1)
    lk.tube(name + 'Plume', P(0.08, 0.02, 1.86), P(-0.2, 0.15, 1.82), 0.04, WHITEM)

def wall_ring(name, poly, z0, z1, mat_for, tile_w=3.0, out=0.0):
    """walls round an outline [(x, y)...] from z0 to z1 whose texture follows the perimeter: u = metres along the walls /
    tile_w, v from 0 at z0 to 1 at z1 (one band of an elevation). mat_for(i, length) picks each wall's material (short
    pieces of a curve can take a different one: ribbon glazing round Nailers Yard's rounded end). out: pushed outwards."""
    n = len(poly); a2 = sum(poly[k][0] * poly[(k + 1) % n][1] - poly[(k + 1) % n][0] * poly[k][1] for k in range(n))
    P = poly if not out else [(x, y) for x, y in _offset(poly, -out)]
    s = 0.0; groups = {}
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]; L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-4: continue
        m = mat_for(i, L); groups.setdefault(m.name, (m, []))[1].append((a, b, s, s + L)); s += L
    for key, (m, quads) in groups.items():
        bm = bmesh.new(); lay = bm.loops.layers.uv.verify()
        for a, b, s0, s1 in quads:
            if a2 < 0: a, b, s0, s1 = b, a, s1, s0   # (faces outward either winding)
            vs = [bm.verts.new((a[0], a[1], z0)), bm.verts.new((b[0], b[1], z0)), bm.verts.new((b[0], b[1], z1)), bm.verts.new((a[0], a[1], z1))]
            f = bm.faces.new(vs)
            for l, t in zip(f.loops, ((s0 / tile_w, 0), (s1 / tile_w, 0), (s1 / tile_w, 1), (s0 / tile_w, 1))): l[lay].uv = t
        me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(m); lk.objs.append(o)

def _offset(polyg, d):
    """each wall line moved d metres inwards (negative: outwards), neighbours intersected"""
    n = len(polyg); a2 = sum(polyg[k][0] * polyg[(k + 1) % n][1] - polyg[(k + 1) % n][0] * polyg[k][1] for k in range(n))
    lines = []
    for k in range(n):
        a, b = polyg[k], polyg[(k + 1) % n]; L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1; ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, ny = (-uy, ux) if a2 > 0 else (uy, -ux)
        lines.append(((a[0] + nx * d, a[1] + ny * d), (ux, uy)))
    out = []
    for k in range(n):
        (p1, d1), (p2, d2) = lines[k - 1], lines[k]; den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-6: out.append(p2); continue
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den; out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
    return out

def clip_half(poly, d, smax):
    """the part of an outline with p . d <= smax (a straight cut across it)"""
    out = []; n = len(poly)
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]; sa, sb = a[0] * d[0] + a[1] * d[1], b[0] * d[0] + b[1] * d[1]
        if sa <= smax: out.append(a)
        if (sa - smax) * (sb - smax) < 0: t = (smax - sa) / (sb - sa); out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out
