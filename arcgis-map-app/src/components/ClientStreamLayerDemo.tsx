import { useEffect, useRef, useState } from 'react'
import Map from '@arcgis/core/Map.js'
import MapView from '@arcgis/core/views/MapView.js'
import StreamLayer from '@arcgis/core/layers/StreamLayer.js'
import Graphic from '@arcgis/core/Graphic.js'
import Point from '@arcgis/core/geometry/Point.js'
import { DEFAULT_CENTER } from '../arcgis/constants'
import { createDictionaryRenderer } from '../arcgis/renderers'
import { formatCoordinate } from '../utils/format'

type UnitDefinition = {
  id: number
  callSign: string
  sidc: string
  radius: number
  speed: number
  phase: number
  latStretch: number
}

type UnitSnapshot = {
  id: number
  callSign: string
  latitude: number
  longitude: number
}

const STREAM_FIELDS: __esri.FieldProperties[] = [
  { name: 'ObjectID', alias: 'ObjectID', type: 'oid' },
  { name: 'trackId', alias: 'Track ID', type: 'string' },
  { name: 'timestamp', alias: 'Timestamp', type: 'date' },
  { name: 'sidc', alias: 'SIDC', type: 'string' },
  { name: 'uniquedesignation', alias: 'Callsign', type: 'string' },
  { name: 'status', alias: 'Status', type: 'string' },
]

const UNIT_TRACKS: UnitDefinition[] = [
  {
    id: 1,
    callSign: 'ECHO-1',
    sidc: 'SFGPUCI----K---',
    radius: 0.25,
    speed: 1.15,
    phase: 0,
    latStretch: 0.65,
  },
  {
    id: 2,
    callSign: 'ECHO-2',
    sidc: 'SFGPUCI----K---',
    radius: 0.22,
    speed: 0.95,
    phase: 120,
    latStretch: 0.55,
  },
  {
    id: 3,
    callSign: 'ECHO-3',
    sidc: 'SFGPUCI----K---',
    radius: 0.28,
    speed: 1.35,
    phase: 240,
    latStretch: 0.7,
  },
]

const CLIENT_STREAM_INTERVAL_MS = 1000

const createClientStreamLayer = () =>
  new StreamLayer({
    title: 'Client dictionary stream',
    geometryType: 'point',
    objectIdField: 'ObjectID',
    spatialReference: { wkid: 4326 },
    purgeOptions: { maxObservations: 1 },
    timeInfo: {
      trackIdField: 'trackId',
      startField: 'timestamp',
    },
    popupTemplate: {
      title: '{uniquedesignation}',
      content: [
        {
          type: 'fields',
          fieldInfos: [
            { fieldName: 'trackId', label: 'Track ID' },
            {
              fieldName: 'timestamp',
              label: 'Last seen',
              format: { dateFormat: 'short-date-short-time' },
            },
            { fieldName: 'status', label: 'Status' },
          ],
        },
      ],
    },
    fields: STREAM_FIELDS,
    renderer: createDictionaryRenderer(),
  })

const computeOrbit = (unit: UnitDefinition, tick: number) => {
  const radians = (((tick * unit.speed) + unit.phase) * Math.PI) / 180
  const longitude = DEFAULT_CENTER.longitude + Math.cos(radians) * unit.radius
  const latitude = DEFAULT_CENTER.latitude + Math.sin(radians) * unit.radius * unit.latStretch

  return { latitude, longitude }
}

const ClientStreamLayerDemo = () => {
  const mapRef = useRef<HTMLDivElement | null>(null)
  const [unitSnapshots, setUnitSnapshots] = useState<UnitSnapshot[]>(
    UNIT_TRACKS.map((unit) => ({
      id: unit.id,
      callSign: unit.callSign,
      latitude: DEFAULT_CENTER.latitude,
      longitude: DEFAULT_CENTER.longitude,
    })),
  )
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  useEffect(() => {
    if (!mapRef.current) {
      return
    }

    const streamLayer = createClientStreamLayer()
    const map = new Map({
      basemap: 'dark-gray-vector',
      layers: [streamLayer],
    })

    const view = new MapView({
      container: mapRef.current,
      map,
      center: DEFAULT_CENTER,
      zoom: 6,
      ui: { components: ['zoom', 'compass', 'attribution'] },
    })

    let tick = 0
    let intervalId: number | undefined
    let isMounted = true

    const pushUpdate = () => {
      const timestamp = Date.now()
      const updates = UNIT_TRACKS.map((unit) => {
        const { latitude, longitude } = computeOrbit(unit, tick)

        const graphic = new Graphic({
          attributes: {
            ObjectID: unit.id,
            trackId: unit.id,
            timestamp,
            sidc: unit.sidc,
            uniquedesignation: unit.callSign,
            status: 'Present',
          },
          geometry: new Point({
            longitude,
            latitude,
            spatialReference: { wkid: 4326 },
          }),
        })

        return {
          payload: graphic.toJSON(),
          snapshot: { id: unit.id, callSign: unit.callSign, latitude, longitude },
        }
      })

      streamLayer.sendMessageToClient({
        type: 'features',
        features: updates.map((entry) => entry.payload),
      })

      setUnitSnapshots(updates.map((entry) => entry.snapshot))
      setLastUpdate(new Date(timestamp))
      tick += 4
    }

    Promise.all([streamLayer.when(), view.when()]).then(() => {
      if (!isMounted) {
        return
      }
      pushUpdate()
      intervalId = window.setInterval(pushUpdate, CLIENT_STREAM_INTERVAL_MS)
    })

    return () => {
      isMounted = false
      if (intervalId) {
        window.clearInterval(intervalId)
      }
      view.destroy()
      map.removeAll()
    }
  }, [])

  return (
    <section className="stream-demo" aria-label="Client-side stream layer showcase">
      <header className="stream-demo__header">
        <div>
          <h2>Client Stream Layer</h2>
          <p>
            Mimics the ArcGIS stream layer client sample by feeding a dictionary-rendered track
            layer entirely from React.
          </p>
        </div>
        <div className="status-pill">
          <span className="status-dot" />
          {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString()}` : 'Awaiting updates'}
        </div>
      </header>

      <div className="stream-demo__content">
        <div className="stream-demo__map" ref={mapRef} aria-label="Client stream layer map" />
        <ul className="stream-demo__list">
          {unitSnapshots.map((unit) => (
            <li key={unit.id} className="unit-row">
              <div>
                <strong>{unit.callSign}</strong>
                <span className="unit-row__subtitle">Track #{unit.id}</span>
              </div>
              <div className="unit-row__coords" aria-label="Current position">
                <span>{formatCoordinate(unit.latitude)}</span>
                <span>{formatCoordinate(unit.longitude)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export default ClientStreamLayerDemo
