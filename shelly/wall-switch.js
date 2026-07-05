// Script for Shelly Gen4 relays
// button press -> toggle Zigbee bulb(s)

let DEBUG = true // Print debug output to the script console

// Z2M: Devices -> bulb ->"Network address" (e.g. 0x1A2B)
let LIGHTS = [0x911c]

// The Zigbee RPC callback fires unreliably, so throttle repeat presses with a
// self-clearing timer. Counting in-flight calls could deadlock if a callback
// is never delivered.
let busy = 0

function debug(message) {
  if (DEBUG) {
    print(message)
  }
}

function toggleLight() {
  if (busy > 2) {
    debug('Send in progress, skipping')
    return
  }
  busy += 1
  Timer.set(1000, false, function () {
    busy -= 1
  })

  for (let i = 0; i < LIGHTS.length; i++) {
    let t = LIGHTS[i]
    debug('Toggling bulb addr ' + t + ' ep 1')
    Shelly.call(
      'Zigbee.SendCommand',
      {
        dst_addr: t,
        dst_ep: 1, // endpoint 1
        cluster: 6, // On/Off
        cmd: 2, // toggle
        timeout_ms: 1000 // ZCL answer response
      },
      function (res, err, msg) {
        if (err) {
          print('ZCL err:', err, msg)
        } else {
          debug('Toggle sent OK')
        }
      }
    )
  }
}

let longPressed = false

Shelly.addEventHandler(function (e) {
  if (e.component !== 'input:0') {
    return
  }

  debug('event: ' + e.info.event + ' on ' + e.component)

  if (e.info.event === 'long_push') {
    longPressed = true
  } else if (e.info.event === 'btn_up') {
    if (!longPressed) {
      toggleLight()
    }
    longPressed = false
  }
})

print('Started: button press -> toggle light')
