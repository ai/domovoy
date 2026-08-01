// Script for Shelly Gen4 relays (Shelly 1PM Mini or Shelly 2PM)
// Fallback for the HA wall switch blueprint: toggles the bulbs over Zigbee
// when HA is unreachable and cannot have handled the press itself.

let DEBUG = false

// Z2M: Devices -> bulb -> Network address (e.g. 0x1A2B). Recheck after a
// bulb rejoins, these addresses are not stable.
let LIGHTS = [0xcd99, 0x2a4b]

// For 2PM case which have multiple buttons.
let INPUT = 'input:0'

// IP, not mDNS: the name may not resolve while the network is the broken part.
let HA_URL = 'https://192.168.50.180/'
let HA_TIMEOUT = 1 // seconds

// Back-to-back Zigbee.SendCommand calls make the radio drop frames
let SEND_GAP_MS = 120

let generation = 0

function debug(message) {
  if (DEBUG) {
    print(message)
  }
}

// Never retry: a lost answer looks like a lost command, but the bulb may have
// toggled already and a second try would put it back
function toggleBulb(addr) {
  Shelly.call(
    'Zigbee.SendCommand',
    {
      dst_addr: addr,
      dst_ep: 1,
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

function checkHaHttp(cb) {
  Shelly.call(
    'HTTP.GET',
    // HA's private CA is not on the device, so the certificate is not verified.
    { url: HA_URL, timeout: HA_TIMEOUT, ssl_ca: '*' },
    function (res, err) {
      if (err || !res) {
        cb(false)
      } else {
        cb(res.code > 0)
      }
    }
  )
}

Shelly.addEventHandler(function (e) {
  if (e.component !== INPUT) {
    return
  }

  debug('event: ' + e.info.event + ' on ' + e.component)

  // The blueprint triggers on single_push too, unlike btn_up which also fires
  // for the halves of a double press
  if (e.info.event === 'single_push') {
    generation += 1
    let myGen = generation
    if (isHaSocketConnected()) {
      debug('HA is connected, leaving the press to it')
      return
    } else {
      checkHaHttp(function (alive) {
        if (myGen !== generation) {
          debug('Superseded by a newer press')
          return
        }
        if (alive) {
          debug('HA answered, leaving the press to it')
          return
        }
        debug('HA unreachable, toggling the light')
        toggleAll()
      })
    }
  } else if (e.info.event !== 'btn_down' && e.info.event !== 'btn_up') {
    // A long or multi press supersedes a single press still being checked
    generation += 1
  }
})

print('Started: single press -> switch light when HA is unreachable')
