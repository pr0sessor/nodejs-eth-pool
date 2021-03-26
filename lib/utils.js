const utils = require('web3-utils')
const bignum = require('bignum')

const diff1 = bignum(2).pow(256)

const generateUnid = (a) => {
  return a ? (a ^ Math.random() * 16 >> a / 4).toString(16) : ([1e10] + 1e10 + 1e9).replace(/[01]/g, generateUnid).toLowerCase()
}

const makeNonce = (size) => {
  const chars = '0123456789abcdef'
  let result = ''
  for (let i = 0; i < size; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

const validateAddress = (address) => {
  return utils.isAddress(address)
}

const diffToTarget = (diff) => {
  return bnToHex(diff1.div(bignum(diff)))
}

const bnToHex = (bn) => {
  const base = 16
  let hex = bn.toString(base)
  if (hex.length % 2) {
    hex = '0' + hex
  }
  return preHex(hex)
}

const preHex = (hex) => {
  if (hex.substr(0, 2) !== '0x') return `0x${hex}`
  return hex
}

const rmPreHex = (hex) => {
  if (hex.substr(0, 2) === '0x') return hex.substr(2)
  return hex
}

const getReadableHashRate = (hashrate) => {
  let i = 0
  const byteUnits = [' H', ' KH', ' MH', ' GH', ' TH', ' PH']
  while (hashrate > 1000) {
    hashrate = hashrate / 1000
    i++
  }
  return hashrate.toFixed(2) + byteUnits[i] + '/sec'
}

const toWei = (value, unit = 'ether') => {
  return utils.toWei(value, unit)
}

const fromWei = (value, unit = 'ether') => {
  return utils.fromWei(value, unit)
}

const numberToHex = (value) => {
  return utils.numberToHex(value)
}

const hexToNumber = (value) => {
  return utils.hexToNumber(value)
}

const ringBuffer = (maxSize) => {
  let data = []
  let cursor = 0
  let isFull = false

  return {
    append: function (x) {
      if (isFull) {
        data[cursor] = x
        cursor = (cursor + 1) % maxSize
      } else {
        data.push(x)
        cursor++
        if (data.length === maxSize) {
          cursor = 0
          isFull = true
        }
      }
    },
    avg: function (plusOne) {
      const sum = data.reduce(function (a, b) { return a + b }, plusOne || 0)
      return sum / ((isFull ? maxSize : cursor) + (plusOne ? 1 : 0))
    },
    size: function () {
      return isFull ? maxSize : cursor
    },
    clear: function () {
      data = []
      cursor = 0
      isFull = false
    }
  }
}

module.exports = {
  generateUnid,
  makeNonce,
  validateAddress,
  diffToTarget,
  bnToHex,
  preHex,
  rmPreHex,
  getReadableHashRate,
  fromWei,
  toWei,
  numberToHex,
  hexToNumber,
  ringBuffer
}
