// Script for Shelly Gen4 relays (Shelly 1PM Mini or Shelly 2PM)
// Fallback for the HA wall switch blueprint: toggles the bulbs over Zigbee
// when HA is unreachable and cannot have handled the press itself.

let DEBUG = false

// Z2M: Devices -> bulb -> Network address (e.g. 0x1A2B). A bulb that keeps
// genOnOff outside endpoint 1 (bulb -> Clusters) needs [address, endpoint].
let LIGHTS = [0xcd99, [0x2a4b, 11]]

// For 2PM case which have multiple buttons.
let INPUT = 'input:0'

// Back-to-back Zigbee.SendCommand calls make the radio drop frames
let SEND_GAP_MS = 120

function debug(message) {
  if (DEBUG) {
    print(message)
  }
}

// Never retry: a lost answer looks like a lost command, but the bulb may have
// toggled already and a second try would put it back
function toggleBulb(light) {
  let addr = light
  let endpoint = 1
  if (typeof light !== 'number') {
    addr = light[0]
    endpoint = light[1]
  }
  Shelly.call(
    'Zigbee.SendCommand',
    {
      dst_addr: addr,
      dst_ep: endpoint,
      cluster: 6, // On/Off
      cmd: 2, // toggle
      timeout_ms: 1000
    },
    function (res, err, msg) {
      if (err) {
        print('ZCL err:', err, msg)
      } else {
        debug('toggled ' + addr)
      }
    }
  )
}

function toggleAll() {
  for (let i = 0; i < LIGHTS.length; i++) {
    if (i === 0) {
      toggleBulb(LIGHTS[0])
    } else {
      Timer.set(
        i * SEND_GAP_MS,
        false,
        function (light) {
          toggleBulb(light)
        },
        LIGHTS[i]
      )
    }
  }
}

function isHaSocketConnected() {
  let cfg = Shelly.getComponentConfig('ws')
  if (!cfg || !cfg.enable || !cfg.server) {
    return false
  }
  let status = Shelly.getComponentStatus('ws')
  return status && status.connected ? true : false
}

Shelly.addEventHandler(function (e) {
  if (e.component !== INPUT) {
    return
  }

  debug('event: ' + e.info.event + ' on ' + e.component)

  // The blueprint triggers on single_push too, unlike btn_up which also fires
  // for the halves of a double press
  if (e.info.event === 'single_push') {
    if (isHaSocketConnected()) {
      debug('HA is connected, leaving the press to it')
      return
    } else {
      debug('HA unreachable, toggling the light')
      toggleAll()
    }
  }
})

print('Started: single press -> switch light when HA is unreachable')
