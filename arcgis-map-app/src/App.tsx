import { useEffect, useRef, useState } from 'react'
import esriConfig from '@arcgis/core/config.js'
import Map from '@arcgis/core/Map.js'
import MapView from '@arcgis/core/views/MapView.js'
import SceneView from '@arcgis/core/views/SceneView.js'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js'
import Point from '@arcgis/core/geometry/Point.js'
import Graphic from '@arcgis/core/Graphic.js'
import './App.css'
import ClientStreamLayerDemo from './components/ClientStreamLayerDemo'
import DictionaryGraphicLayerDemo from './components/DictionaryGraphicLayerDemo'
import { DEFAULT_CENTER } from './arcgis/constants'
import { createDictionaryRenderer } from './arcgis/renderers'
import { formatCoordinate } from './utils/format'

type ViewMode = '2d' | '3d'
type RendererEnabledGraphicsLayer = GraphicsLayer & { renderer: __esri.Renderer }

const STREAM_INTERVAL_MS = 1000
const STREAM_RADIUS_DEGREES = 0.015
const STREAM_LAT_STRETCH = 0.6
const STREAM_ID = 'UNIT-01'

esriConfig.assetsPath = `${import.meta.env.BASE_URL}assets`

const createStreamRenderer = () => createDictionaryRenderer()

const App = () => {
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<MapView | SceneView | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const [latestPosition, setLatestPosition] = useState(DEFAULT_CENTER)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    if (!mapNodeRef.current) {
      return
    }

    let isDisposed = false
    let intervalId: number | undefined

    const map = new Map({
      basemap: viewMode === '2d' ? 'streets-navigation-vector' : 'satellite',
      ground: 'world-elevation',
    })

    const streamLayer = new GraphicsLayer({
      title: 'Client stream layer',
      elevationInfo: viewMode === '3d' ? { mode: 'relative-to-ground', offset: 25 } : undefined,
    }) as RendererEnabledGraphicsLayer
    streamLayer.renderer = createStreamRenderer()

    map.add(streamLayer)

    const baseViewProperties: Partial<
      __esri.MapViewProperties & __esri.SceneViewProperties
    > = {
      container: mapNodeRef.current,
      map,
      padding: { top: 0 },
      popup: {
        dockEnabled: true,
        dockOptions: {
          position: 'top-right',
          breakpoint: false,
        },
      },
    }

    viewRef.current?.destroy()

    const view =
      viewMode === '2d'
        ? new MapView({
            ...baseViewProperties,
            center: { ...DEFAULT_CENTER },
            zoom: 13,
            ui: { components: ['zoom', 'compass', 'attribution'] },
          })
        : new SceneView({
            ...baseViewProperties,
            viewingMode: 'local',
            camera: {
              position: {
                longitude: DEFAULT_CENTER.longitude - 0.05,
                latitude: DEFAULT_CENTER.latitude + 0.05,
                z: 2500,
              },
              tilt: 65,
              heading: 95,
            },
            qualityProfile: 'high',
            ui: { components: ['navigation-toggle', 'compass', 'attribution'] },
          })

    viewRef.current = view

    view
      .when()
      .then(() => {
        if (isDisposed) {
          return
        }

        const streamGraphic = new Graphic({
          attributes: {
            sidc: 'SFGPUCI----K---',
            uniquedesignation: STREAM_ID,
            status: 'Present',
          },
          geometry: new Point({
            ...DEFAULT_CENTER,
            spatialReference: { wkid: 4326 },
          }),
          popupTemplate: {
            title: `{uniquedesignation}`,
            content:
              'Client-side stream graphic rendered with the ArcGIS Dictionary Renderer and updated every second.',
          },
        })

        streamLayer.add(streamGraphic)

        let step = 0

        const updateGraphicPosition = () => {
          if (isDisposed) {
            return
          }

          const radians = ((step % 360) * Math.PI) / 180
          const longitude =
            DEFAULT_CENTER.longitude + Math.cos(radians) * STREAM_RADIUS_DEGREES
          const latitude =
            DEFAULT_CENTER.latitude +
            Math.sin(radians) * STREAM_RADIUS_DEGREES * STREAM_LAT_STRETCH

          streamGraphic.geometry = new Point({
            longitude,
            latitude,
            spatialReference: { wkid: 4326 },
          })

          setLatestPosition({ longitude, latitude })
          setLastUpdated(new Date())

          step += 12
        }

        updateGraphicPosition()
        intervalId = window.setInterval(updateGraphicPosition, STREAM_INTERVAL_MS)
      })
      .catch((error) => {
        console.error('Unable to initialize the view', error)
      })

    return () => {
      isDisposed = true
      if (intervalId) {
        window.clearInterval(intervalId)
      }
      streamLayer.removeAll()
      view.destroy()
      viewRef.current = null
    }
  }, [viewMode])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>ArcGIS Live Stream Map</h1>
          <p>
            Switch between 2D and 3D experiences while a client-side stream layer
            updates a dictionary-rendered icon every second.
          </p>
        </div>
        <div className="view-toggle" role="group" aria-label="Toggle view mode">
          <button
            type="button"
            className={viewMode === '2d' ? 'active' : ''}
            onClick={() => setViewMode('2d')}
          >
            2D view
          </button>
          <button
            type="button"
            className={viewMode === '3d' ? 'active' : ''}
            onClick={() => setViewMode('3d')}
          >
            3D view
          </button>
        </div>
      </header>

      <section className="info-panel" aria-live="polite">
        <article className="stat-card">
          <h3>Track ID</h3>
          <strong>{STREAM_ID}</strong>
        </article>
        <article className="stat-card">
          <h3>Last update</h3>
          <strong>{lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</strong>
        </article>
        <article className="stat-card">
          <h3>Position</h3>
          <strong>
            {formatCoordinate(latestPosition.latitude)}, {formatCoordinate(latestPosition.longitude)}
          </strong>
        </article>
        <article className="stat-card">
          <h3>Stream</h3>
          <div className="status-pill">
            <span className="status-dot" />
            Live updates
          </div>
        </article>
      </section>

      <div className="map-container">
        <div className="map-view" ref={mapNodeRef} aria-label="ArcGIS map view" />
      </div>

      <ClientStreamLayerDemo />
      <DictionaryGraphicLayerDemo />
    </div>
  )
}

export default App
