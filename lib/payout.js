const moment = require('moment')
const async = require('async')

const logger = require('./logger')
const utils = require('./utils')
const rpc = require('./rpc')

const config = require('../config')

const { Balance, Payout } = require('../models')

function sendPayment (address, amount) {
  const tx = {
    from: config.stratumServer.poolAddress,
    to: address,
    value: utils.preHex(amount.toString(16)),
    gas: utils.preHex(config.payout.gas.toString(16)),
    gasPrice: utils.preHex(config.payout.gasPrice.toString(16))
  }
  rpc('eth_sendTransaction', [tx], (err, hash) => {
    if (err) return logger('error', 'payout', err.message)
    Balance.findOne({ address }, (err2, balance) => {
      if (err2) return logger('error', 'mongo', err2.message)
      Object.assign(balance, {
        pending: Number(balance.pending) - amount,
        paid: Number(balance.paid) + amount
      }).save()
      Payout.create({
        address,
        amount,
        hash,
        datePaid: moment().unix()
      })
      logger('success', 'payout', `Sent ${amount.toString()} to ${address}. Hash: ${hash}`)
    })
  })
}

function payout () {
  logger('info', 'payout', 'Started')
  async.waterfall([

    // Get all miners with pending balance
    function (callback) {
      Balance.find({ pending: { $ne: '0' } }, (err, miners) => {
        if (err) return callback(new Error(`Error trying to get candidate blocks from database ${[err]}`))
        if (miners.length === 0) return callback(new Error('No miners with pending balance'))
        callback(null, miners)
      })
    },

    // Check if payout threshold reached
    function (miners, callback) {
      miners = miners.filter(miner => Number(miner.pending) >= config.payout.threshold)
      callback(null, miners)
    },

    // Handle payments
    function (miners, callback) {
      if (miners.length === 0) return callback(new Error('No miners reach the payout threshold'))
      miners.forEach(miner => {
        sendPayment(miner.address, Number(miner.pending))
      })
      callback(null)
    }
  ], function (err) {
    if (err) logger('warn', 'payout', err.message)
    logger('success', 'payout', 'Finished')
  })
}
payout()
setInterval(payout, config.payout.interval * 1000)
