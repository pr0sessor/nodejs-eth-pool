const async = require('async')

const logger = require('./logger')

const config = require('../config')

const { Hashrate } = require('../models')

logger('info', 'cron', 'Started')

function clearHashrate () {
  async.waterfall([
    function (callback) {
      Hashrate.deleteMany({ createdAt: { $lt: new Date(Date.now() - (7200 * 1000)) } })
      callback(null)
    }
  ], () => {
    logger('success', 'cron', 'Finished')
    setTimeout(clearHashrate, config.cron.clearHashrateInterval * 1000)
  })
}

clearHashrate()
