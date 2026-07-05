// Script for Shelly Gen4 relays
// Fallback for the HA wall switch blueprint: HA sees the same button press
// via Zigbee2MQTT and toggles the light group. The script reads the first
// bulb state on press, waits, and reads it again — if nothing changed
// (HA is down), it drives the bulbs directly. The fallback sends explicit
// on/off instead of toggle: if HA turns out to be just slow, a duplicate
// command sets the same state instead of toggling it back.

let DEBUG = true // Print debug output to the script console

// Z2M: Devices -> bulb ->"Network address" (e.g. 0x1A2B)
// The first bulb state is used to detect the HA reaction, so put the
// closest/most reliable one first
let LIGHTS = [0xcd99, 0x2a4b]

// Time for the HA automation to toggle the bulbs before the fallback fires
let HA_WAIT_MS = 100

// Back-to-back Zigbee.SendCommand calls make the radio drop frames, so
// per-bulb sends are spaced with timers instead of chaining RPC callbacks
// (which may never fire)
let SEND_GAP_MS = 120

// Explicit on/off is idempotent, so the whole volley is repeated once
// to cover a lost frame
let REPEAT_DELAY_MS = 350

// Ignore presses while a press is being processed, cleared by timer only
// so an undelivered callback cannot deadlock the lock
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

function scheduleSend(addr, cmd, delay) {
  if (delay === 0) {
    sendCmd(addr, cmd)
  } else {
    Timer.set(delay, false, function () {
      sendCmd(addr, cmd)
    })
  }
}

function sendToAll(cmd, repeat) {
  for (let i = 0; i < LIGHTS.length; i++) {
    scheduleSend(LIGHTS[i], cmd, i * SEND_GAP_MS)
  }
  if (repeat) {
    Timer.set(REPEAT_DELAY_MS, false, function () {
      sendToAll(cmd, false)
    })
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

function handlePress() {
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
      // Direction is unknown; a blind toggle could undo the HA reaction,
      // so leave this press to HA
      debug('State read failed, leaving the press to HA')
      return
    }
    Timer.set(HA_WAIT_MS, false, function () {
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

function enableWiFi() {
  debug('Held 10s -> enabling WiFi')
  Shelly.call(
    'WiFi.SetConfig',
    { config: { sta: { enable: true } } },
    function (res, err, msg) {
      if (err) {
        print('WiFi err:', err, msg)
      }
    }
  )

  // Blink the light (toggle, then toggle back) to confirm the hold fired
  sendToAll(2, false)
  Timer.set(1000, false, function () {
    sendToAll(2, false)
  })
}

let longPressed = false
let wifiTimer = null

Shelly.addEventHandler(function (e) {
  if (e.component !== 'input:0') {
    return
  }

  debug('event: ' + e.info.event + ' on ' + e.component)

  if (e.info.event === 'btn_down') {
    wifiTimer = Timer.set(10000, false, function () {
      wifiTimer = null
      enableWiFi()
    })
  } else if (e.info.event === 'long_push') {
    longPressed = true
  } else if (e.info.event === 'btn_up') {
    if (wifiTimer !== null) {
      Timer.clear(wifiTimer)
      wifiTimer = null
    }
    if (!longPressed) {
      handlePress()
    }
    longPressed = false
  }
})

print('Started: button press -> toggle light (HA fallback)')
