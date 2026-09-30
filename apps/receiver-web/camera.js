export function describeCameraError(error) {
  const name = error?.name || 'Error';
  const message = error?.message || 'Unknown camera error';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        code: 'permission-denied',
        title: 'Camera permission blocked',
        detail: 'Allow camera access for this site in the browser address-bar/site settings, then press Start Camera again.',
        technical: `${name}: ${message}`,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        code: 'no-camera',
        title: 'No camera found',
        detail: 'No usable camera was reported by the browser. Connect/enable a webcam or open the receiver on a phone with a camera.',
        technical: `${name}: ${message}`,
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        code: 'camera-busy',
        title: 'Camera is busy or blocked by the OS',
        detail: 'Close other apps/tabs using the camera and check Windows/Android/iOS camera privacy settings, then retry.',
        technical: `${name}: ${message}`,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        code: 'constraints',
        title: 'Requested camera mode is unavailable',
        detail: 'The requested camera settings are not supported. The receiver will normally fall back automatically to a simpler camera mode.',
        technical: `${name}: ${message}`,
      };
    case 'SecurityError':
      return {
        code: 'security',
        title: 'Browser security blocked the camera',
        detail: 'Open the receiver using HTTPS and verify that camera access is allowed for this site.',
        technical: `${name}: ${message}`,
      };
    case 'AbortError':
      return {
        code: 'aborted',
        title: 'Camera start was interrupted',
        detail: 'The camera initialization was interrupted. Wait a moment and press Start Camera again.',
        technical: `${name}: ${message}`,
      };
    default:
      return {
        code: 'unknown',
        title: 'Camera could not start',
        detail: 'Check camera permission, close other camera apps, and retry. The technical error is shown below.',
        technical: `${name}: ${message}`,
      };
  }
}

export function buildCameraAttempts(deviceId = '') {
  const attempts = [];

  if (deviceId) {
    attempts.push({
      label: 'selected camera',
      constraints: {
        audio: false,
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
    });
  }

  attempts.push(
    {
      label: 'rear/environment camera',
      constraints: {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
    },
    {
      label: 'any available camera',
      constraints: { audio: false, video: true },
    },
  );

  return attempts;
}

export async function openCameraWithFallback(mediaDevices, deviceId = '', onAttempt = () => {}) {
  if (!mediaDevices?.getUserMedia) {
    const error = new Error('navigator.mediaDevices.getUserMedia is unavailable');
    error.name = 'SecurityError';
    throw error;
  }

  let lastError = null;
  for (const attempt of buildCameraAttempts(deviceId)) {
    try {
      onAttempt(attempt.label);
      const stream = await mediaDevices.getUserMedia(attempt.constraints);
      return { stream, attempt: attempt.label };
    } catch (error) {
      lastError = error;
      // Permission/security/busy errors are not constraint-specific; retrying different
      // constraints can trigger repeated prompts or add delay without helping.
      if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError', 'NotReadableError', 'TrackStartError'].includes(error?.name)) {
        break;
      }
    }
  }

  throw lastError || new Error('Unable to acquire a camera stream');
}

export async function listVideoInputs(mediaDevices) {
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'videoinput');
}
