#!/bin/bash
# setup.sh <scratch dir> <riders>: a copy of the app with test routes, riders and sessions; starts it on port 9443.
# Never point the load at the live server. Remove the scratch dir afterwards (it holds a copy of .env).
set -e
LT=$1; N=$2; APP=$(cd "$(dirname "$0")/../.." && pwd)
rm -rf "$LT"; mkdir -p "$LT/app/data/routes"
rsync -a --exclude data --exclude .git "$APP/" "$LT/app/"
cp "$(dirname "$0")"/load.js "$(dirname "$0")"/run.sh "$LT/"
cd "$LT" && node -e "
const fs=require('fs'),crypto=require('crypto'),N=$N;
const src=JSON.parse(fs.readFileSync('$APP/data/routes.json')).find(r=>r.id==='brighton-rocks-ede8f1');
const routes=[];
for(let i=0;i<Math.ceil(N/10);i++){routes.push({...src,id:'lt-route-'+i,kind:'server',segments:undefined});fs.copyFileSync('$APP/data/routes/brighton-rocks-ede8f1.gpx','app/data/routes/lt-route-'+i+'.gpx');}
fs.writeFileSync('app/data/routes.json',JSON.stringify(routes));
const users=[],sessions={},tokens=[];
for(let i=0;i<N;i++){const u='lt'+i;users.push({username:u,name:'Load '+i,admin:false,created:new Date().toISOString(),settings:{jersey:'#ff6a1a'},salt:'x',hash:'x'});const t=crypto.randomBytes(32).toString('hex');sessions[t]={username:u,expires:Date.now()+864e5};tokens.push(t);}
fs.writeFileSync('app/data/users.json',JSON.stringify(users));fs.writeFileSync('app/data/sessions.json',JSON.stringify(sessions));fs.writeFileSync('tokens.json',JSON.stringify(tokens));"
cd "$LT/app" && (PORT=9443 nohup node server.js > "$LT/server.log" 2>&1 & echo $! > "$LT/server.pid")
sleep 2; cat "$LT/server.log"
