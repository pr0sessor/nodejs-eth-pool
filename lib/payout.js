const moment = require('moment')
const async = require('async')

const logger = require('./logger')
const utils = require('./utils')
const rpc = require('./rpc')

const config = require('../config')

const { Reward, Payout } = require('../models')

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
    Reward.updateMany({ address, status: 'pending' }, { status: 'paid' }, (err2, balance) => {
      if (err2) return logger('error', 'mongo', err2.message)
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
      Reward.find({ status: 'pending' }, (err, rewards) => {
        if (err) return callback(new Error(`Error trying to get candidate blocks from database ${[err]}`))
        if (rewards.length === 0) return callback(new Error('No miners with pending balance'))
        const balances = []
        rewards.forEach(reward => {
          if (!balances[reward.address]) {
            balances[reward.address] = Number(reward.amount)
          } else {
            balances[reward.address] += Number(reward.amount)
          }
        })
        callback(null, balances)
      })
    },

    // Check if payout threshold reached
    function (balances, callback) {
      balances = Object.keys(balances).filter(i => balances[i] >= config.payout.threshold)
      console.log(balances)
      callback(null, balances)
    },

    // Handle payments
    function (balances, callback) {
      if (balances.length === 0) return callback(new Error('No miners reach the payout threshold'))
      Object.keys(balances).forEach(address => {
        sendPayment(address, balances[address].amount)
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
