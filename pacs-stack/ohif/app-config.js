/** @type {AppTypes.Config} */
// Browser-resolved reporting API (DICOMweb proxy). Override before this script:
//   window.__REPORTING_API_URL__ = 'http://your-host:8081';
const isLocalhost =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const runtimeHost = window.location.hostname;
const runtimeProtocol = window.location.protocol;
const reportingApiBaseUrl = (
  window.__REPORTING_API_URL__ ||
  (isLocalhost ? 'http://localhost:8081' : `${runtimeProtocol}//${runtimeHost}:8081`)
).replace(/\/$/, '');
const reportingDicomwebRoot = (
  window.__REPORTING_DICOMWEB_ROOT__ || `${reportingApiBaseUrl}/dicom-web`
).replace(/\/$/, '');
const reportingWadoUriRoot = (
  window.__REPORTING_WADO_URI_ROOT__ || `${reportingApiBaseUrl}/wado`
).replace(/\/$/, '');

const AI_HEATMAP_PROTOCOL_ID = 'tdai.aiHeatmapOverlay';
const AI_HEATMAP_PROTOCOL = {
  id: AI_HEATMAP_PROTOCOL_ID,
  name: 'AI Heatmap Overlay',
  locked: true,
  imageLoadStrategy: 'interleaveTopToBottom',
  protocolMatchingRules: [
    {
      id: 'hasParametricMap',
      weight: 1000,
      attribute: 'ModalitiesInStudy',
      required: true,
      constraint: {
        contains: {
          value: 'PMAP',
        },
      },
    },
  ],
  displaySetSelectors: {
    aiHeatmapDisplaySet: {
      seriesMatchingRules: [
        {
          id: 'isPmap',
          weight: 100,
          attribute: 'Modality',
          required: true,
          constraint: {
            equals: {
              value: 'PMAP',
            },
          },
        },
        {
          id: 'seriesNumber900',
          weight: 100,
          attribute: 'SeriesNumber',
          required: false,
          constraint: {
            equals: {
              value: 900,
            },
          },
        },
        {
          id: 'seriesDescriptionContainsAiHeatmap',
          weight: 100,
          attribute: 'SeriesDescription',
          required: false,
          constraint: {
            containsI: {
              value: 'AI Heatmap',
            },
          },
        },
      ],
    },
  },
  stages: [
    {
      id: 'tdai-ai-heatmap-stage',
      name: 'AI Heatmap Overlay',
      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 1,
        },
      },
      viewports: [
        {
          viewportOptions: {
            viewportId: 'aiHeatmapOverlayViewport',
            viewportType: 'volume',
          },
          displaySets: [
            {
              id: 'aiHeatmapDisplaySet',
              options: {
                // Preferred display settings for AI PMAP overlay.
                colormap: {
                  name: 'jet',
                  opacity: [
                    { value: 0.0, opacity: 0.0 },
                    { value: 0.25, opacity: 0.45 },
                    { value: 0.5, opacity: 0.45 },
                    { value: 1.0, opacity: 0.45 },
                  ],
                },
                voi: {
                  windowCenter: 0.5,
                  windowWidth: 1.0,
                },
                blendMode: 'overlay',
              },
            },
          ],
        },
      ],
    },
  ],
  numberOfPriorsReferenced: -1,
};

function registerAiHeatmapProtocol(servicesManager) {
  const { hangingProtocolService } = servicesManager.services;
  if (!hangingProtocolService.getProtocolById(AI_HEATMAP_PROTOCOL_ID)) {
    hangingProtocolService.addProtocol(AI_HEATMAP_PROTOCOL_ID, AI_HEATMAP_PROTOCOL);
  }
}

window.config = {
  routerBasename: '/',
  showStudyList: true,
  showLoadingIndicator: true,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: 'orthanc',
  // OHIF v3.10+ uses customizationService for hotkeys and runtime behavior.
  customizationService: [
    {
      'ohif.hotkeyBindings': {
        $push: [
          {
            commandName: 'setHangingProtocol',
            commandOptions: {
              protocolId: AI_HEATMAP_PROTOCOL_ID,
              stageIndex: 0,
              reset: true,
            },
            label: 'Apply AI Heatmap Overlay',
            keys: ['shift+h'],
            isEditable: true,
          },
          {
            commandName: 'toggleHangingProtocol',
            commandOptions: {
              protocolId: AI_HEATMAP_PROTOCOL_ID,
              stageIndex: 0,
            },
            label: 'Toggle AI Heatmap Overlay',
            keys: ['h'],
            isEditable: true,
          },
        ],
      },
    },
  ],

  extensions: [
    '@ohif/extension-default',
    '@ohif/extension-cornerstone',
    '@ohif/extension-measurement-tracking',
    '@ohif/extension-cornerstone-dicom-sr',
    '@ohif/extension-cornerstone-dicom-seg',
    '@ohif/extension-cornerstone-dicom-rt',
    '@ohif/extension-cornerstone-dicom-pmap',
  ],
  modes: [
    '@ohif/mode-longitudinal',
    '@ohif/mode-segmentation',
  ],
  modesConfiguration: {
    '@ohif/mode-longitudinal': {
      // Prefer AI heatmap overlay protocol when PMAP exists, otherwise fallback.
      hangingProtocol: {
        $set: [AI_HEATMAP_PROTOCOL_ID, 'default'],
      },
      onModeEnter: {
        $apply: previousOnModeEnter =>
          function tdaiOnModeEnter(context) {
            if (typeof previousOnModeEnter === 'function') {
              previousOnModeEnter.call(this, context);
            }
            registerAiHeatmapProtocol(context.servicesManager);
          },
      },
    },
  },

  whiteLabeling: {
    createLogoComponentFn: function (React) {
      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 } },
        React.createElement(
          'span',
          { style: { color: '#005EB8', fontWeight: 700, fontSize: '18px' } },
          'TDAI Rad'
        ),
        React.createElement(
          'span',
          { style: { color: '#64748B', fontSize: '10px' } },
          'Powered by Trivitron Digital'
        )
      );
    },
  },

  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'Orthanc PACS',
        name: 'orthanc',
        qidoRoot: '/dicom-web',
        wadoRoot: '/dicom-web',
        wadoUriRoot: '/wado',
        qidoSupportsIncludeField: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicoogle',
      configuration: {
        friendlyName: 'TDAI DICOMweb (reporting API)',
        name: 'TDAI',
        crossOriginCookies: true,
        wadoUriRoot: reportingWadoUriRoot,
        qidoRoot: reportingDicomwebRoot,
        wadoRoot: reportingDicomwebRoot,
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: false,
        supportsWildcard: false,
        omitQuotationForMultipartRequest: true,
        bulkDataURI: {
          enabled: true,
        },
      },
    },
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'Local DICOM Files',
      },
    },
  ],
};
