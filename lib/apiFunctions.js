const logger = require('./logger')
const rpc = require('./rpc')
const utils = require('./utils')

const config = require('../config')

const networkStats = (cb) => {
  rpc('eth_getBlockByNumber', ['latest', false], (err, block) => {
    if (err) return logger('error', 'upstream', 'Failed to get latest block number')
    const difficulty = utils.hexToNumber(block.difficulty)
    cb(null, {
      height: utils.hexToNumber(block.number),
      difficulty,
      hashrate: parseInt(difficulty / config.blockTime)
    })
  })
}

module.exports = {
  networkStats
}
