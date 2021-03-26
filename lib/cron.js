const moment = require('moment')
const async = require('async')

const logger = require('./logger')

const config = require('../config')

const { Hashrate, Miner } = require('../models')

function clearHashrate () {
  logger('info', 'cron', 'Started')
  logger('info', 'cron', 'Clearing hashrate')
  async.waterfall([
    function (callback) {
      Hashrate.deleteMany({ createdAt: { $lt: moment(Date.now() - (1800 * 1000)).toDate() } })
      callback(null)
    }
  ], () => {
    setTimeout(clearHashrate, config.cron.clearHashrateInterval * 1000)
  })
}

function clearMinersOnlineStatus () {
  logger('info', 'cron', 'Clearing miners online status')
  async.waterfall([
    function (callback) {
      Miner.updateMany({ lastShare: { $lt: moment().unix() - 600 } }, { status: 'offline' })
      callback(null)
    }
  ], () => {
    logger('success', 'cron', 'Finished')
    setTimeout(clearMinersOnlineStatus, config.cron.clearHashrateInterval * 1000)
  })
}

clearHashrate()
clearMinersOnlineStatus()
