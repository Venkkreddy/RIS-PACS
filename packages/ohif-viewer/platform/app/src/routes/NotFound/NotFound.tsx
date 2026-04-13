import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Icons } from '@ohif/ui-next';
import { useAppConfig } from '@state';

const LEGACY_DICOM_UID_PATTERN = /^\d+(?:\.\d+)+$/;

const NotFound = ({
  message = "We can't find the page you're looking for.",
  showGoBackButton = true,
}) => {
  const [appConfig] = useAppConfig();
  const { showStudyList } = appConfig;
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Backward compatibility: accept /viewer/:StudyInstanceUID(/:dataSource) URLs.
    // OHIF v3 expects StudyInstanceUIDs in query params instead.
    const pathParts = location.pathname.split('/').filter(Boolean);
    if (pathParts[0]?.toLowerCase() !== 'viewer') {
      return;
    }
    if (pathParts.length < 2 || pathParts.length > 3) {
      return;
    }

    const legacyStudyUid = decodeURIComponent(pathParts[1] || '');
    if (!LEGACY_DICOM_UID_PATTERN.test(legacyStudyUid)) {
      return;
    }

    const legacyDataSource = pathParts[2] ? decodeURIComponent(pathParts[2]) : null;
    const nextPath = legacyDataSource
      ? `/viewer/${encodeURIComponent(legacyDataSource)}`
      : '/viewer';
    const params = new URLSearchParams(location.search);

    if (!params.get('StudyInstanceUIDs') && !params.get('studyInstanceUIDs')) {
      params.set('StudyInstanceUIDs', legacyStudyUid);
    }

    navigate(`${nextPath}?${params.toString()}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const reportingWorklist = appConfig?.reporting?.uiBaseUrl
    ? `${appConfig.reporting.uiBaseUrl}/worklist`
    : '/worklist';

  return (
    <div className="bg-background absolute flex h-full w-full items-center justify-center">
      <div className="flex flex-col">
        <div className="bg-background flex items-center justify-center rounded-t-2xl p-6">
          <Icons.IllustrationNotFound />
        </div>
        <div className="bg-input h-px" />
        <div className="bg-muted flex flex-col items-center justify-center rounded-b-2xl p-8 text-center">
          <h1 className="text-foreground text-[22px] font-light">Error (404)</h1>
          <p className="text-muted-foreground mt-1 text-[16px] font-light">{message}</p>
          <p className="text-muted-foreground mt-2 text-[14px] font-light">
            Please select a specific patient study from the worklist.
          </p>
          {showGoBackButton && showStudyList && (
            <Button
              className="mt-8 px-3 text-lg"
              onClick={() => navigate('/')}
            >
              Return to Study List
            </Button>
          )}
          {showGoBackButton && !showStudyList && (
            <Button
              className="mt-8 px-3 text-lg"
              onClick={() => {
                window.location.href = reportingWorklist;
              }}
            >
              Return to Worklist
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

NotFound.propTypes = {
  message: PropTypes.string,
  showGoBackButton: PropTypes.bool,
};

export default NotFound;
