FROM orthancteam/orthanc:latest

# Install python3-pip and DICOM libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-setuptools \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages pynetdicom pydicom requests
