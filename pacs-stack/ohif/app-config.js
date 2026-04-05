/** @type {AppTypes.Config} */
window.config = {
  routerBasename: '/',
  showStudyList: true,
  showLoadingIndicator: true,
  maxNumberOfWebWorkers: 3,
  defaultDataSourceName: 'orthanc',

  extensions: [
    '@ohif/extension-default',
    '@ohif/extension-cornerstone',
    '@ohif/extension-measurement-tracking',
    '@ohif/extension-cornerstone-dicom-sr',
  ],
  modes: [
    '@ohif/mode-longitudinal',
  ],

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
      namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
      sourceName: 'dicomlocal',
      configuration: {
        friendlyName: 'Local DICOM Files',
      },
    },
  ],
};
