const config = require('./config.json')

const args = {
  stratum: false,
  unlocker: false,
  payout: false,
  api: false,
  cron: false
}

process.argv.forEach(function (val) {
  if (val.startsWith('--stratum')) args.stratum = true
  if (val.startsWith('--unlocker')) args.unlocker = true
  if (val.startsWith('--payout')) args.payout = true
  if (val.startsWith('--api')) args.api = true
  if (val.startsWith('--cron')) args.cron = true
})

if (args.stratum) config.stratumServer.enabled = args.stratum
if (args.unlocker) config.unlocker.enabled = args.unlocker
if (args.payout) config.payout.enabled = args.payout
if (args.api) config.api.enabled = args.api
if (args.cron) config.cron.enabled = args.cron

module.exports = config
