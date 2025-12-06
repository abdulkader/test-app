import { useEffect, useRef } from 'react'
import Map from '@arcgis/core/Map.js'
import MapView from '@arcgis/core/views/MapView.js'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js'
import Graphic from '@arcgis/core/Graphic.js'
import Point from '@arcgis/core/geometry/Point.js'
import { DEFAULT_CENTER } from '../arcgis/constants'
import { createDictionaryRenderer } from '../arcgis/renderers'

type RendererReadyGraphicsLayer = GraphicsLayer & { renderer: __esri.Renderer }

const UNIT_SYMBOLS = [
  {
    id: 'ALPHA-1',
    sidc: 'SFGPUCI----K---',
    description: 'Infantry',
    offset: { lat: 0.12, lon: -0.15 },
  },
  {
    id: 'BRAVO-2',
    sidc: 'SHGPUCIR---H---',
    description: 'Recon',
    offset: { lat: 0.08, lon: 0.2 },
  },
  {
    id: 'CHARLIE-3',
    sidc: 'SFGPUCA----K---',
    description: 'Armor',
    offset: { lat: -0.1, lon: -0.05 },
  },
  {
    id: 'DELTA-4',
    sidc: 'SUAPCF-----H---',
    description: 'Support',
    offset: { lat: -0.14, lon: 0.16 },
  },
]

const DictionaryGraphicLayerDemo = () => {
  const mapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!mapRef.current) {
      return
    }

    const graphicsLayer = new GraphicsLayer({
      title: 'Dictionary symbols',
      listMode: 'hide',
    }) as RendererReadyGraphicsLayer
    graphicsLayer.renderer = createDictionaryRenderer()

    const map = new Map({
      basemap: 'gray-vector',
      layers: [graphicsLayer],
    })

    const view = new MapView({
      container: mapRef.current,
      map,
      center: DEFAULT_CENTER,
      zoom: 8,
      ui: { components: ['zoom', 'compass', 'attribution'] },
    })

    const graphics = UNIT_SYMBOLS.map(
      (unit, index) =>
        new Graphic({
          attributes: {
            sidc: unit.sidc,
            uniquedesignation: unit.id,
            status: 'Present',
            order: index + 1,
            description: unit.description,
          },
          geometry: new Point({
            longitude: DEFAULT_CENTER.longitude + unit.offset.lon,
            latitude: DEFAULT_CENTER.latitude + unit.offset.lat,
            spatialReference: { wkid: 4326 },
          }),
          popupTemplate: {
            title: unit.id,
            content: unit.description,
          },
        }),
    )

    view.when().then(() => {
      graphicsLayer.addMany(graphics)
    })

    return () => {
      graphicsLayer.removeAll()
      view.destroy()
    }
  }, [])

  return (
    <section className="dictionary-demo" aria-label="Dictionary symbols rendered with a graphics layer">
      <header className="dictionary-demo__header">
        <div>
          <h2>Dictionary Graphic Layer</h2>
          <p>Renders static MIL-STD-2525 symbols directly from a graphics layer.</p>
        </div>
      </header>

      <div className="dictionary-demo__content">
        <div className="dictionary-demo__map" ref={mapRef} aria-label="Dictionary symbol map" />
        <ul className="dictionary-demo__list">
          {UNIT_SYMBOLS.map((unit) => (
            <li key={unit.id}>
              <strong>{unit.id}</strong>
              <span>{unit.description}</span>
              <code>{unit.sidc}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default DictionaryGraphicLayerDemo
