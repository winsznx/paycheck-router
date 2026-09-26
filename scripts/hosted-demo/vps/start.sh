#!/bin/sh
# Fresh fork on every start: no state survives a restart except the bootstrap snapshot.
set -eu
cd /opt/paycheck-surfnet
rm -rf run && mkdir run && cd run
snap=""
[ -f /opt/paycheck-surfnet/snapshots/bootstrap.json ] && snap="--snapshot /opt/paycheck-surfnet/snapshots/bootstrap.json"
exec /opt/paycheck-surfnet/bin/surfpool start --host 127.0.0.1 --port 18899 --ws-port 18900 \
  --no-tui --no-studio --no-deploy --yes --airdrop-amount 0 --log-level warn --disable-instruction-profiling --max-profiles 20 $snap
