/** @type {AppTypes.Config} */

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const runtimeHost = window.location.hostname;
const runtimeProtocol = window.location.protocol;
const reportingApiBaseUrl = (window.__REPORTING_API_URL__ || '').replace(/\/+$/, '');
const reportingDicomwebRoot = (
  window.__REPORTING_DICOMWEB_ROOT__ || (reportingApiBaseUrl ? `${reportingApiBaseUrl}/dicom-web` : '/dicom-web')
).replace(/\/+$/, '');
const reportingWadoUriRoot = (
  window.__REPORTING_WADO_URI_ROOT__ || (reportingApiBaseUrl ? `${reportingApiBaseUrl}/wado` : '/wado')
).replace(/\/+$/, '');
const reportingUiBaseUrl =
  window.__REPORTING_UI_URL__ || (isLocalhost ? 'http://localhost:5173' : `${runtimeProtocol}//${runtimeHost}:5173`);

window.config = {
  routerBasename: '/',
  showStudyList: true,
  showLoadingIndicator: true,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: 'dicoogle',
  extensions: [
    '@ohif/extension-default',
    '@ohif/extension-cornerstone',
    '@ohif/extension-measurement-tracking',
    '@ohif/extension-cornerstone-dicom-sr',
    '@ohif/extension-cornerstone-dicom-seg',
  ],
  modes: [
    '@ohif/mode-longitudinal',
    '@ohif/mode-segmentation',
  ],
  reporting: {
    baseUrl: reportingApiBaseUrl,
    uiBaseUrl: reportingUiBaseUrl,
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
      sourceName: 'dicoogle',
      configuration: {
        friendlyName: 'TDAI DICOMWeb',
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
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'orthanc',
      configuration: {
        friendlyName: 'Orthanc PACS',
        name: 'orthanc',
        qidoRoot: '/orthanc/dicom-web',
        wadoRoot: '/orthanc/dicom-web',
        wadoUriRoot: '/orthanc/wado',
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
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'Local DICOM Files',
      },
    },
  ],
};

