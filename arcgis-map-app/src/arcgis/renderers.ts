import DictionaryRenderer from '@arcgis/core/renderers/DictionaryRenderer.js'
import SimpleRenderer from '@arcgis/core/renderers/SimpleRenderer.js'
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js'

const DICTIONARY_STYLE_URL =
  'https://www.arcgis.com/sharing/rest/content/items/0b7f07556eae4869935b14c469b3cb29/data'

export const createDictionaryRenderer = () => {
  try {
    return new DictionaryRenderer({
      url: DICTIONARY_STYLE_URL,
      fieldMap: {
        sidc: 'sidc',
        uniquedesignation: 'uniquedesignation',
        status: 'status',
      },
      config: {
        textVisible: false,
      },
    })
  } catch (error) {
    console.warn('Falling back to basic renderer', error)
    return new SimpleRenderer({
      symbol: new SimpleMarkerSymbol({
        color: '#1d72f2',
        size: 12,
        outline: {
          color: '#ffffff',
          width: 1.5,
        },
      }),
    })
  }
}
