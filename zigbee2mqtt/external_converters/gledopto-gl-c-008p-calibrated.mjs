// External converter (Zigbee2MQTT 2.x / ESM) for the Gledopto GL-C-008P
// controller driving a CCT strip whose real usable range is 2500 K (100% warm
// channel) .. 6000 K (100% cold).
//
// The controller's nominal color-temp scale (2000..6329 K) does not equal the
// strip's real output — it is just the warm/cold channel mix. This converter
// remaps color temperature so a requested real temperature renders on the strip,
// transparently for Home Assistant, Adaptive Lighting and the group.
//
// Endpoints of the calibration (all in mireds):
//   real 6000 K = 167 mired  -> command 158 mired (100% cold channel)
//   real 2500 K = 400 mired  -> command 500 mired (100% warm channel)
// Linear between them.

import * as fz from 'zigbee-herdsman-converters/converters/fromZigbee'
import * as tz from 'zigbee-herdsman-converters/converters/toZigbee'
import * as exposes from 'zigbee-herdsman-converters/lib/exposes'
import * as utils from 'zigbee-herdsman-converters/lib/utils'

const e = exposes.presets

const D_MIN = 167 // real coldest, mired (6000 K)
const D_MAX = 400 // real warmest, mired (2500 K)
const C_MIN = 158 // controller command coldest, mired
const C_MAX = 500 // controller command warmest, mired

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// desired real mired -> command mired sent to the device
const toCmd = d =>
  Math.round(
    C_MIN +
      ((clamp(d, D_MIN, D_MAX) - D_MIN) * (C_MAX - C_MIN)) / (D_MAX - D_MIN)
  )

// device command mired -> real mired reported back to HA
const toReal = c =>
  clamp(
    Math.round(D_MIN + ((c - C_MIN) * (D_MAX - D_MIN)) / (C_MAX - C_MIN)),
    D_MIN,
    D_MAX
  )

const tzColorTempCalibrated = {
  key: ['color_temp'],
  convertSet: async (entity, key, value, meta) => {
    const d = clamp(Number(value), D_MIN, D_MAX)
    const transtime =
      meta.message && meta.message.transition != null
        ? meta.message.transition * 10
        : 0
    await entity.command(
      'lightingColorCtrl',
      'moveToColorTemp',
      { colortemp: toCmd(d), transtime },
      utils.getOptions(meta.mapped, entity)
    )
    return { state: { color_mode: 'color_temp', color_temp: d } }
  },
  convertGet: async (entity, key, meta) => {
    await entity.read('lightingColorCtrl', ['colorTemperature'])
  }
}

const fzColorTempCalibrated = {
  cluster: 'lightingColorCtrl',
  type: ['attributeReport', 'readResponse'],
  convert: (model, msg, publish, options, meta) => {
    if (msg.data.colorTemperature !== undefined) {
      return {
        color_temp: toReal(msg.data.colorTemperature),
        color_mode: 'color_temp'
      }
    }
  }
}

export default {
  zigbeeModel: ['GL-C-008P'],
  model: 'GL-C-008P',
  vendor: 'Gledopto',
  description:
    'Zigbee LED Controller RGB+CCT (pro) — calibrated CCT, real 2500-6000K',
  fromZigbee: [fz.on_off, fz.brightness, fzColorTempCalibrated],
  toZigbee: [tz.on_off, tz.light_onoff_brightness, tzColorTempCalibrated],
  exposes: [e.light_brightness_colortemp([D_MIN, D_MAX])],
  meta: {}
}
