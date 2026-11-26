#!/bin/bash
# run.sh <riders> <seconds>: load + measure the test server's CPU and memory over the steady part
LT=$(dirname "$0"); PID=$(cat $LT/server.pid); N=$1; S=$2
ROOM=$ROOM node $LT/load.js $N $S > $LT/out.json &
LP=$!
sleep $(( N / 200 + 6 ))
T0=$(awk '{print $14+$15}' /proc/$PID/stat); W0=$(date +%s.%N)
sleep 15
T1=$(awk '{print $14+$15}' /proc/$PID/stat); W1=$(date +%s.%N)
RSS=$(awk '/VmRSS/{print $2}' /proc/$PID/status)
# an API request while loaded
LAT=$(curl -sk -o /dev/null -w '%{time_total}' https://127.0.0.1:9443/login.html)
wait $LP
echo "$(cat $LT/out.json) serverCPU=$(echo "($T1-$T0)/100/($W1-$W0)*100" | bc -l | xargs printf '%.0f')% rssMB=$((RSS/1024)) pageMs=$(echo "$LAT*1000" | bc | xargs printf '%.0f')"
