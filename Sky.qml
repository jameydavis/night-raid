// The 3x10 LED night sky behind smoked plastic. Column 0 holds the three
// cities (warm amber blocks), column 1 the launcher's track, and raiders fly
// in from the right. Unlit LEDs stay faintly visible like the real thing.
import QtQuick
import QtQuick.Effects

Rectangle {
  id: field

  property var leds: []
  property real cell: 46
  readonly property int cols: 10
  readonly property int lanes: 3

  implicitWidth: cols * cell + cell * 0.5
  implicitHeight: lanes * cell + cell * 0.5
  radius: cell * 0.12
  color: "#120403"
  border.width: 2
  border.color: "#2a0d0a"

  readonly property real ox: cell * 0.25
  readonly property real oy: cell * 0.25

  // The coastline: a painted line between the cities and the launcher's
  // track and the open sky.
  Rectangle {
    x: field.ox + 2 * field.cell - 1
    y: field.oy - field.cell * 0.12
    width: 2
    height: field.lanes * field.cell + field.cell * 0.24
    color: "#3d1410"
  }

  // Unlit LED segments: always faintly visible behind the smoked plastic.
  Repeater {
    model: field.cols * field.lanes
    Rectangle {
      readonly property int level: field.leds.length > index ? field.leds[index] : 0
      readonly property bool city: index % field.cols === 0
      visible: level === 0 && !city
      x: field.ox + (index % field.cols) * field.cell + (field.cell - width) / 2
      y: field.oy + Math.floor(index / field.cols) * field.cell + (field.cell - height) / 2
      width: field.cell * (city ? 0.5 : 0.66)
      height: field.cell * (city ? 0.5 : 0.3)
      radius: city ? field.cell * 0.08 : height / 2
      color: city ? "#2e1d06" : "#3a0c09"
    }
  }

  // The cities, unlit: three dark skylines that are always faintly visible.
  Repeater {
    model: field.lanes
    CityIcon {
      lit: false
      x: field.ox + (field.cell - width) / 2
      y: field.oy + index * field.cell + (field.cell - height) / 2
    }
  }

  // The glow: blurred copies of the lit layer drawn underneath it, a wide
  // soft bloom plus a tighter halo. The blur keeps each LED's own color, so
  // the bright ball carrier blooms more than the dimmer defenders.
  MultiEffect {
    source: lit
    x: lit.x; y: lit.y; width: lit.width; height: lit.height
    autoPaddingEnabled: false
    blurEnabled: true
    blurMax: 64
    blur: 1.0
    blurMultiplier: 0.6
    brightness: 0.5
    saturation: 0.3
  }
  MultiEffect {
    source: lit
    x: lit.x; y: lit.y; width: lit.width; height: lit.height
    autoPaddingEnabled: false
    blurEnabled: true
    blurMax: 20
    blur: 0.9
    brightness: 0.3
  }

  // Lit LEDs, rendered into their own layer so the glow can sample them.
  // The layer has a fixed margin for the glow to spread into, so the blurred
  // copies and the crisp LEDs share exactly the same geometry.
  readonly property real glowPad: cell * 1.4
  Item {
    id: lit
    x: -field.glowPad
    y: -field.glowPad
    width: field.width + field.glowPad * 2
    height: field.height + field.glowPad * 2
    layer.enabled: true

    Repeater {
      model: field.lanes
      CityIcon {
        lit: true
        visible: field.leds.length > index * field.cols && field.leds[index * field.cols] === 6
        x: field.glowPad + field.ox + (field.cell - width) / 2
        y: field.glowPad + field.oy + index * field.cell + (field.cell - height) / 2
      }
    }

    Repeater {
      model: field.cols * field.lanes
      Item {
        readonly property int level: field.leds.length > index ? field.leds[index] : 0
        visible: level > 0 && level !== 6
        x: field.glowPad + field.ox + (index % field.cols) * field.cell
        y: field.glowPad + field.oy + Math.floor(index / field.cols) * field.cell
        width: field.cell
        height: field.cell

        // Raiders and the launcher are pill-shaped LED segments; shells are
        // small dots, blasts big hot circles, and cities warm amber blocks.
        readonly property bool isShell: level === 4
        readonly property bool isBlast: level === 5
        readonly property bool isCity: level === 6

        Rectangle {
          anchors.centerIn: parent
          width: field.cell * (isCity ? 0.5 : isBlast ? 0.62 : isShell ? 0.26 : 0.66)
          height: isCity || isBlast || isShell ? width : field.cell * 0.3
          radius: isCity ? field.cell * 0.08 : height / 2
          color: isCity ? "#ffb020"
               : isBlast ? "#ff7a3c"
               : level === 1 ? "#c41d10"
               : level === 2 ? "#ff3b24"
               : "#ff4a30"
          border.width: level === 3 || isBlast ? 2 : isCity ? 0 : level === 2 ? 2 : 0
          border.color: isBlast ? "#ffe0c8" : level === 2 ? "#ff8a6e" : "#ffb19e"
          // A small specular highlight so lit LEDs read as domes, not flat.
          Rectangle {
            readonly property bool round: isShell || isBlast || isCity
            x: parent.width * (round ? 0.2 : 0.16); y: parent.height * 0.18
            width: parent.width * (round ? 0.26 : 0.3)
            height: round ? width : parent.height * 0.26
            radius: height / 2
            color: "#ffffff"
            opacity: level >= 3 ? 0.55 : 0.25
          }
        }
      }
    }
  }

  // A city: three simplified buildings of different heights with blacked-out
  // windows. Lit cities glow amber; a lost city stays dark like an unlit LED.
  component CityIcon: Item {
    id: cityIcon
    property bool lit: true
    width: field.cell * 0.7
    height: field.cell * 0.62
    readonly property color body: lit ? "#ffb020" : "#2e1d06"
    readonly property color window: lit ? "#2a1402" : "#170d03"

    // [x, width, height] as fractions of the icon, plus the window grid.
    Repeater {
      model: [
        { x: 0.0, w: 0.28, h: 0.62, cols: 1, rows: 2 },
        { x: 0.33, w: 0.34, h: 1.0, cols: 2, rows: 3 },
        { x: 0.72, w: 0.28, h: 0.78, cols: 1, rows: 2 }
      ]
      Rectangle {
        readonly property var b: modelData
        x: b.x * cityIcon.width
        width: b.w * cityIcon.width
        height: b.h * cityIcon.height
        y: cityIcon.height - height
        radius: cityIcon.width * 0.03
        color: cityIcon.body

        Grid {
          anchors.horizontalCenter: parent.horizontalCenter
          y: parent.height * 0.14
          columns: b.cols
          columnSpacing: cityIcon.width * 0.05
          rowSpacing: cityIcon.height * 0.08
          Repeater {
            model: b.cols * b.rows
            Rectangle {
              width: cityIcon.width * 0.075
              height: width
              color: cityIcon.window
            }
          }
        }
      }
    }
  }
}
