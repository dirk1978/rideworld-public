#!/bin/sh
# Builds rideworld.apk (the Android app: apps/android). Needs only Docker: the Android SDK runs in a container
# (Dockerfile, the same image as Current's and GIF Maker's). No Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner.
# The signing key: release.keystore + ANDROID_KEYSTORE_PASSWORD in ./.env (both made the first time, both git-ignored,
# both in the nightly backup with the rideworld folder). Keep them: updates must be signed with the same key.
# The APK is copied to the share (<your files folder>) when the 4TB is mounted.
set -e
cd "$(dirname "$0")"
ENV=.env; touch "$ENV"; chmod 600 "$ENV"
PASS=$(sed -n 's/^ANDROID_KEYSTORE_PASSWORD=//p' "$ENV" | tail -1)
if [ -z "$PASS" ]; then
  [ -f release.keystore ] && { echo "release.keystore exists but ANDROID_KEYSTORE_PASSWORD is not set in .env"; exit 1; }
  PASS=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9'); printf 'ANDROID_KEYSTORE_PASSWORD=%s\n' "$PASS" >> "$ENV"
fi
IMAGE=${ANDROID_BUILD_IMAGE:-current-android-build}
CODE=$(( ($(date +%s) - 1704067200) / 60 ))
VERSION=$(date +%Y.%m.%d.%H%M)
DOCKER=docker; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
$DOCKER image inspect "$IMAGE" >/dev/null 2>&1 || $DOCKER build -t "$IMAGE" .
rm -rf build && mkdir -p build
$DOCKER run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e PASS="$PASS" -e VERSION="$VERSION" -e CODE="$CODE" \
  -v "$PWD":/w -w /w "$IMAGE" sh -euc '
  JAR=/opt/android/platforms/android-34/android.jar
  mkdir -p build/res build/classes build/dex build/gen
  aapt2 compile --dir app/res -o build/res/res.zip
  aapt2 link -o build/unsigned.apk -I $JAR --manifest app/AndroidManifest.xml \
        --version-name "$VERSION" --version-code "$CODE" --replace-version --java build/gen build/res/res.zip
  javac --release 11 -Xlint:-options -nowarn -classpath $JAR -d build/classes $(find app/src build/gen -name "*.java")
  d8 --release --min-api 29 --lib $JAR --output build/dex $(find build/classes -name "*.class")
  (cd build/dex && zip -q ../unsigned.apk classes.dex)
  zipalign -f -p 4 build/unsigned.apk build/aligned.apk
  [ -f release.keystore ] || keytool -genkeypair -keystore release.keystore -storepass "$PASS" -keypass "$PASS" \
        -alias rideworld -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=RideWorld" 2>/dev/null
  apksigner sign --ks release.keystore --ks-pass "pass:$PASS" --out rideworld.apk build/aligned.apk
  apksigner verify rideworld.apk
'
echo "Built apps/android/rideworld.apk ($VERSION)"
if [ -d <your files folder> ]; then cp rideworld.apk <your files folder> && echo "Copied to the share: 4TB/Apps/RideWorld.apk"; fi
