/** @type {AppTypes.Config} */

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const reportingApiBaseUrl =
  window.__REPORTING_API_URL__ || (isLocalhost ? 'http://localhost:8081' : 'https://tdairad-api.fly.dev');
const reportingUiBaseUrl = window.__REPORTING_UI_URL__ || (isLocalhost ? 'http://localhost:5173' : 'https://tdairad.com');
const dicoogleBaseUrl = window.__DICOOGLE_BASE_URL__ || (isLocalhost ? 'http://localhost:8080' : 'https://tdairad-dicoogle.fly.dev');

window.config = {
  routerBasename: '/',
  showStudyList: false,
  showLoadingIndicator: true,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: 'dicoogle',
  extensions: ['@ohif/extension-default', '@ohif/extension-cornerstone'],
  modes: ['@ohif/mode-longitudinal'],
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
        wadoUriRoot: `${reportingApiBaseUrl}/wado`,
        qidoRoot: `${reportingApiBaseUrl}/dicom-web`,
        wadoRoot: `${reportingApiBaseUrl}/dicom-web`,
        qidoSupportsIncludeField: false,
        supportsReject: false,
        imageRendering: 'wadouri',
        thumbnailRendering: 'wadouri',
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
