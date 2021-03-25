const mongoose = require('mongoose')
const BigNumberSchema = require('mongoose-bignumber')
const { toJSON, paginate } = require('./plugins')

const Schema = mongoose.Schema(
  {
    address: {
      type: String,
      trim: true,
      unique: true,
      lowercase: true
    },
    immature: {
      type: BigNumberSchema,
      default: '0'
    },
    pending: {
      type: BigNumberSchema,
      default: '0'
    },
    paid: {
      type: BigNumberSchema,
      default: '0'
    }
  },
  {
    timestamps: true
  }
)

// add plugin that converts mongoose to json
Schema.plugin(toJSON)
Schema.plugin(paginate)

const Balance = mongoose.model('Balance', Schema)

module.exports = Balance
