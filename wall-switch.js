// Script for Shelly Gen4 relays
// short press (<1s)          -> toggle Zigbee group
// long-short-long-short-long -> enable WiFi

const GROUP_ID = 1 // Zigbee group ID from Z2M
const MAX_PRESS_MS = 1000 // Long press timing
const SEQUENCE_GAP_MS = 3000 // Pattern timing
const WIFI_PATTERN = 'LSLSL' // WiFi command pattern (L - long, S - short)

let longReached = false
let longTimer = null
let gapTimer = null
let seq = ''

function toggleLight() {
  Shelly.call(
    'Zigbee.SendCommand',
    {
      dst_addr: GROUP_ID,
      dst_ep: 0, // 0 = groupcast
      cluster: 6, // On/Off
      cmd: 2, // toggle
      timeout_ms: 1000 // ZCL answer response
    },
    (res, err, msg) => {
      if (err) print('Group ZCL err:', err, msg)
    }
  )
}

function enableWifi() {
  Shelly.call(
    'WiFi.SetConfig',
    { config: { sta: { enable: true } } },
    (res, err, msg) => {
      if (err) {
        print('WiFi enable err:', err, msg)
      } else {
        print('WiFi enabled')
      }
    }
  )
}

function registerPress(c) {
  if (gapTimer !== null) Timer.clear(gapTimer)
  gapTimer = Timer.set(SEQUENCE_GAP_MS, false, () => {
    seq = ''
    gapTimer = null
  })

  seq = seq + c
  if (seq.length > WIFI_PATTERN.length) {
    seq = seq.slice(seq.length - WIFI_PATTERN.length, seq.length)
  }
  if (seq === WIFI_PATTERN) {
    seq = ''
    if (gapTimer !== null) {
      Timer.clear(gapTimer)
      gapTimer = null
    }
    enableWifi()
  }
}

Shelly.addEventHandler(e => {
  if (e.component !== 'input:0') return

  if (e.info.event === 'btn_down') {
    longReached = false
    if (longTimer !== null) Timer.clear(longTimer)
    longTimer = Timer.set(MAX_PRESS_MS, false, () => {
      longReached = true
      longTimer = null
    })
  }

  if (e.info.event === 'btn_up') {
    if (longTimer !== null) {
      Timer.clear(longTimer)
      longTimer = null
    }
    if (longReached) {
      registerPress('L')
    } else {
      registerPress('S')
      toggleLight()
    }
  }
})

print('Started: S->group toggle, L-S-L-S-L->WiFi on')
