@echo off
REM SSH tunnel: local 27018 -> droplet mongod (127.0.0.1:27017). The backend .env points MONGO_*_URL at 27018.
ssh -N -L 27018:127.0.0.1:27017 tnbjp-droplet
