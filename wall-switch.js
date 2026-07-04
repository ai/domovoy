// Script for Shelly Gen4 relays
// button press -> toggle Zigbee bulb(s)

let DEBUG = true // Print debug output to the script console

// Z2M: Devices -> bulb ->"Network address" (e.g. 0x1A2B)
let LIGHTS = [{ addr: 0xa753, ep: 1 }]

function toggleLight() {
  for (let i = 0; i < LIGHTS.length; i++) {
    let t = LIGHTS[i]
    if (DEBUG) {
      print('toggleLight: toggling bulb addr', t.addr, 'ep', t.ep)
    }
    Shelly.call(
      'Zigbee.SendCommand',
      {
        dst_addr: t.addr,
        dst_ep: t.ep,
        cluster: 6, // On/Off
        cmd: 2, // toggle
        timeout_ms: 1000 // ZCL answer response
      },
      function (res, err, msg) {
        if (err) {
          print('ZCL err:', err, msg)
        } else if (DEBUG) {
          print('toggleLight: toggle sent OK')
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

  if (DEBUG) {
    print('event:', e.info.event, 'on', e.component)
  }

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
