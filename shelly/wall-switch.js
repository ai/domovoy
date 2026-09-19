// Script for Shelly Gen4 relays (Shelly 1PM Mini or Shelly 2PM)
// Fallback for the HA wall switch blueprint: toggles the bulbs over Zigbee
// when the press did not reach the lamps through Home Assistant & Z2M.

let DEBUG = false

// Z2M: Devices -> bulb -> Network address (e.g. 0x1A2B). A bulb that keeps
// genOnOff outside endpoint 1 (bulb -> Clusters) needs [address, endpoint].
let LIGHTS = [0xcd99, [0x2a4b, 11]]

// A message to this group that proves Z2M is alive and executing commands
let GROUP_TOPIC = 'zigbee2mqtt/Light Group / Andrey'

// For 2PM case which have multiple buttons.
let INPUT = 'input:0'

let HA_WAIT_MS = 1000
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

let pressCount = 0
let waitTimer = null

function stopWaiting() {
  Timer.clear(waitTimer)
  waitTimer = null
  pressCount = 0
}

function onWaitOver() {
  // Presses in pairs cancel each other out, so one toggle covers the window
  let odd = pressCount % 2 === 1
  debug('Z2M stayed silent after ' + pressCount + ' press(es)')
  waitTimer = null
  pressCount = 0
  if (odd) {
    toggleAll()
  }
}

// The window only asks whether Z2M answers at all, so any message closes it
MQTT.subscribe(GROUP_TOPIC, function () {
  if (waitTimer !== null) {
    debug('Z2M reported the change, the press was handled')
    stopWaiting()
  }
})

Shelly.addEventHandler(function (e) {
  if (e.component !== INPUT) {
    return
  }

  debug('event: ' + e.info.event + ' on ' + e.component)

  // The blueprint triggers on single_push too, unlike btn_up which also fires
  // for the halves of a double press
  if (e.info.event === 'single_push') {
    if (!MQTT.isConnected()) {
      debug('No broker, nobody to wait for')
      toggleAll()
      return
    }
    pressCount = pressCount + 1
    if (waitTimer === null) {
      waitTimer = Timer.set(HA_WAIT_MS, false, onWaitOver)
    }
  }
})

print('Started: single press -> switch light when the lamps stay silent')
