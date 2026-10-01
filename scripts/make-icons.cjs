// Renders Volante's mark to resources/volante-icon.png (app) and
// resources/volante-tray.png (system tray). Run with: npm run icons
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

// A V built from a grid of dots that stream into one orange-red point.
// Coordinates are on a 1932-unit tile.
const VX = { '-4': 408, '-3': 524, '-2': 641, '-1': 758, 0: 966, 1: 1174, 2: 1291, 3: 1408, 4: 1524 }
const VY = [487, 607, 727, 846, 966, 1086, 1206, 1326]
const VROWS = [[-4, -3, 0, 3, 4], [-4, -3, 0, 3, 4], [-3, -2, 0, 2, 3], [-3, -2, 0, 2, 3], [-2, -1, 0, 1, 2], [-2, -1, 0, 1, 2], [-1, 0, 1], [-1, 0, 1]]
function mark(color, accent, r = 48.5) {
  const dots = VROWS.flatMap((cols, row) => cols.map((c) => `<circle cx="${VX[c]}" cy="${VY[row]}" r="${r}" fill="${color}"/>`))
  return dots.join('') + `<circle cx="966" cy="1446" r="${r}" fill="${accent}"/>`
}

const APP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1932 1932" width="512" height="512">
  <rect x="0" y="0" width="1932" height="1932" rx="420" fill="#0d0d0d"/>
  ${mark('#f5f3ef', '#ec4a2c')}
</svg>`

// Slightly fatter dots so the tray icon holds together at 16 px.
const TRAY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="340 420 1252 1100" width="64" height="64">${mark('#ffffff', '#ff5a3d', 56)}</svg>`

async function render(svg, size) {
  // Draw the SVG onto a canvas in a hidden page and hand back PNG bytes.
  const w = new BrowserWindow({ show: false })
  await w.loadURL('about:blank')
  const dataUrl = await w.webContents.executeJavaScript(`new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = ${size}; c.height = ${size}
      c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
      res(c.toDataURL('image/png'))
    }
    img.onerror = () => rej(new Error('svg failed'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)})
  })`)
  w.destroy()
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const dir = join(__dirname, '..', 'resources')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'volante-icon.png'), await render(APP, 512))
  writeFileSync(join(dir, 'volante-tray.png'), await render(TRAY, 32))
  console.log('icons written to', dir)
  app.quit()
})
