// Script for Shelly Gen4 relays
// Fallback for the HA wall switch blueprint: HA sees the same button press
// over WiFi (Shelly integration) and toggles the light group. The script
// reads the first bulb state on press, waits, and reads it again.
// IKf nothing changed (HA is down), it drives the bulbs directly.

let DEBUG = true // Print debug output to the script console

// Z2M: Devices -> bulb -> Network address (e.g. 0x1A2B)
let LIGHTS = [0xcd99, 0x2a4b]

let HA_WAIT_MS = 600

// Back-to-back Zigbee.SendCommand calls make the radio drop frames, so
// per-bulb sends are spaced with timers instead of chaining RPC callbacks
// (which may never fire)
let SEND_GAP_MS = 120

// Shelly is limited of how many Zigbee.SendCommand can be in waiting
let BUSY_MS = 1000
let busy = 0

function debug(message) {
  if (DEBUG) {
    print(message)
  }
}

function sendCmd(addr, cmd) {
  Shelly.call(
    'Zigbee.SendCommand',
    {
      dst_addr: addr,
      dst_ep: 1, // endpoint 1
      cluster: 6, // On/Off
      cmd: cmd, // 0 off, 1 on, 2 toggle
      timeout_ms: 1000 // ZCL answer response
    },
    function (res, err, msg) {
      if (err) {
        print('ZCL err:', err, msg)
      } else {
        debug('cmd ' + cmd + ' sent to ' + addr)
      }
    }
  )
}

function sendToAll(cmd) {
  for (let i = 0; i < LIGHTS.length; i++) {
    let delay = i * SEND_GAP_MS
    let light = LIGHTS[i]
    if (delay === 0) {
      sendCmd(light, cmd)
    } else {
      Timer.set(delay, false, function () {
        sendCmd(light, cmd)
      })
    }
  }
}

// Calls back with true/false for on/off, or null if the read failed
function readFirstBulb(cb) {
  Shelly.call(
    'Zigbee.ReadAttr',
    {
      dst_addr: LIGHTS[0],
      dst_ep: 1,
      cluster: 6, // On/Off
      attr: 0, // OnOff state
      timeout_ms: 600
    },
    function (res, err, msg) {
      if (err || !res || !res.success) {
        print('ZCL read err:', err, msg)
        cb(null)
      } else {
        cb(res.value !== '00')
      }
    }
  )
}

let longPressed = false
let haWaitTimer = null

Shelly.addEventHandler(function (e) {
  if (e.component !== 'input:0') {
    return
  }

  debug('event: ' + e.info.event + ' on ' + e.component)

  if (e.info.event === 'long_push') {
    longPressed = true
  } else if (e.info.event === 'btn_up') {
    if (!longPressed) {
      if (haWaitTimer !== null) {
        // The pending check compares against a stale bulb state
        Timer.clear(haWaitTimer)
        haWaitTimer = null
        debug('Cancelled previous HA wait')
      }
      if (busy > 2) {
        debug('Busy, skipping press')
        return
      }
      busy += 1
      Timer.set(BUSY_MS, false, function () {
        busy -= 1
      })

      readFirstBulb(function (before) {
        if (before === null) {
          debug('State read failed, leaving the press to HA')
          return
        }
        haWaitTimer = Timer.set(HA_WAIT_MS, false, function () {
          haWaitTimer = null
          readFirstBulb(function (after) {
            if (after === null || after !== before) {
              debug('HA handled the press')
              return
            }
            debug('No reaction from HA, sending ' + (before ? 'off' : 'on'))
            sendToAll(before ? 0 : 1, true)
          })
        })
      })
    }
    longPressed = false
  }
})

print('Started: button press -> toggle light (HA fallback)')
