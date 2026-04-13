import { DicomMetadataStore, Types } from '@ohif/core';

type StudyMetadata = Types.StudyMetadata;

/**
 * Compare function for sorting
 *
 * @param a - some simple value (string, number, timestamp)
 * @param b - some simple value
 * @param defaultCompare - default return value as a fallback when a===b
 * @returns - compare a and b, returning 1 if a<b -1 if a>b and defaultCompare otherwise
 */
const compare = (a, b, defaultCompare = 0): number => {
  if (a === b) {
    return defaultCompare;
  }
  if (a < b) {
    return 1;
  }
  return -1;
};

/**
 * The studies from display sets gets the studies in study date
 * order or in study instance UID order - not very useful, but
 * if not specifically specified then at least making it consistent is useful.
 */
const getStudiesfromDisplaySets = (
  displaySets: Array<{ StudyInstanceUID?: string }> = []
): StudyMetadata[] => {
  const studyMap: Record<string, boolean> = {};

  const ret = displaySets.reduce<StudyMetadata[]>((prev, curr) => {
    const { StudyInstanceUID } = curr ?? {};
    if (!StudyInstanceUID || studyMap[StudyInstanceUID]) {
      return prev;
    }
    const study = DicomMetadataStore.getStudy(StudyInstanceUID);
    if (study) {
      studyMap[StudyInstanceUID] = true;
      prev.push(study);
    }
    return prev;
  }, []);
  // Return the sorted studies, first on study date and second on study instance UID
  ret.sort((a, b) => {
    return compare(a.StudyDate, b.StudyDate, compare(a.StudyInstanceUID, b.StudyInstanceUID));
  });
  return ret;
};

/**
 * The studies retrieve from the Uids is faster and gets the studies
 * in the original order, as specified.
 */
const getStudiesFromUIDs = (studyUids?: string[]): StudyMetadata[] | undefined => {
  if (!studyUids?.length) {
    return;
  }
  const studies = studyUids
    .map(uid => DicomMetadataStore.getStudy(uid))
    .filter(Boolean) as StudyMetadata[];
  return studies.length > 0 ? studies : undefined;
};

/** Gets the array of studies */
const getStudies = (
  studyUids?: string[],
  displaySets: Array<{ StudyInstanceUID?: string }> = []
): StudyMetadata[] => {
  return getStudiesFromUIDs(studyUids) || getStudiesfromDisplaySets(displaySets);
};

export default getStudies;

export { getStudies, getStudiesFromUIDs, getStudiesfromDisplaySets, compare };
