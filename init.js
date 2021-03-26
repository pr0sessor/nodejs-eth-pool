const mongoose = require('mongoose')

const logger = require('./lib/logger')
const config = require('./config')

mongoose.connect(config.mongoose.url, config.mongoose.options, (err) => {
  if (err) {
    logger('error', 'mongo', 'Error connecting to MongoDB')
    process.exit()
  }
})

if (config.stratumServer.enabled) {
  require('./lib/socket.js')
  require('./lib/stratum.js')
}
if (config.unlocker.enabled) {
  require('./lib/unlocker.js')
}
if (config.payout.enabled) {
  require('./lib/payout.js')
}
if (config.api.enabled) {
  require('./lib/api.js')
}
if (config.cron.enabled) {
  require('./lib/cron.js')
}
