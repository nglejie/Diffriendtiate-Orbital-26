import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PEER_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const PROFILE_STATUSES = new Set(["online", "away", "dnd", "invisible"]);

function displayName(user) {
  return user?.name || user?.displayName || user?.email || "You";
}

function normalizeProfileStatus(value) {
  const status = String(value || "").trim();
  return PROFILE_STATUSES.has(status) ? status : "online";
}

function localParticipant(room, areaId, user, media, profileStatus = "online") {
  return {
    areaId,
    joinedAt: new Date().toISOString(),
    media,
    profileStatus: normalizeProfileStatus(profileStatus),
    roomId: room?.id || "",
    user,
    userId: user?.id || "local-user",
  };
}

function mediaState(muted, cameraOff, deafened, screenSharing = false) {
  return { muted, cameraOff, deafened, screenSharing };
}

function normalizeMeetingSummaries(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((summary) => {
      const areaId = String(summary?.areaId || "").trim();
      const users = Array.isArray(summary?.users) ? summary.users : [];
      if (!areaId || !users.length) return null;
      return {
        areaId,
        roomId: String(summary?.roomId || ""),
        users,
      };
    })
    .filter(Boolean);
}

function mergeUserProfile(currentUser, nextUser) {
  if (!currentUser || !nextUser || currentUser.id !== nextUser.id) return currentUser;
  return { ...currentUser, ...nextUser };
}

function mergeParticipantProfile(participant, nextUser) {
  if (!participant || participant.userId !== nextUser?.id) return participant;
  return {
    ...participant,
    user: mergeUserProfile(participant.user, nextUser),
  };
}

function supportsWebRtc() {
  return typeof RTCPeerConnection !== "undefined";
}

function countTransceiversForKind(peer, kind) {
  return (
    peer
      .getTransceivers?.()
      .filter(
        (transceiver) =>
          transceiver.sender?.track?.kind === kind ||
          transceiver.receiver?.track?.kind === kind,
      ).length || 0
  );
}

function ensureReceiveTransceivers(peer) {
  if (!peer?.addTransceiver || !peer.getTransceivers) return;
  if (!countTransceiversForKind(peer, "audio")) {
    peer.addTransceiver("audio", { direction: "recvonly" });
  }

  // Keep two video m-lines available so a late joiner can receive both camera and screen tracks.
  while (countTransceiversForKind(peer, "video") < 2) {
    peer.addTransceiver("video", { direction: "recvonly" });
  }
}

export function useLimeetsMeeting({ room, socket, user, profileStatus = "online" }) {
  const [activeAreaId, setActiveAreaId] = useState("");
  const [meetingSummaries, setMeetingSummaries] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [mediaError, setMediaError] = useState("");
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cameraOff, setCameraOff] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState(null);

  const activeAreaIdRef = useRef("");
  const cameraOffRef = useRef(true);
  const deafenedRef = useRef(false);
  const localStreamRef = useRef(null);
  const mutedRef = useRef(true);
  const participantMediaRef = useRef(new Map());
  const peerConnectionsRef = useRef(new Map());
  const remoteScreenStreamsRef = useRef({});
  const remoteStreamsRef = useRef({});
  const remoteTrackBucketsRef = useRef(new Map());
  const profileStatusRef = useRef(normalizeProfileStatus(profileStatus));
  const roomRef = useRef(room);
  const screenSharingRef = useRef(false);
  const screenStreamRef = useRef(null);
  const socketRef = useRef(socket);
  const userRef = useRef(user);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    profileStatusRef.current = normalizeProfileStatus(profileStatus);
  }, [profileStatus]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    participantMediaRef.current = new Map(
      participants.map((participant) => [participant.userId, participant.media || {}]),
    );
  }, [participants]);

  useEffect(() => {
    remoteStreamsRef.current = remoteStreams;
  }, [remoteStreams]);

  useEffect(() => {
    remoteScreenStreamsRef.current = remoteScreenStreams;
  }, [remoteScreenStreams]);

  function rememberParticipantMedia(users) {
    if (!Array.isArray(users)) return;
    const next = new Map(participantMediaRef.current);
    users.forEach((participant) => {
      if (participant?.userId) next.set(participant.userId, participant.media || {});
    });
    participantMediaRef.current = next;
  }

  const upsertMeetingSummary = useCallback((areaId, users) => {
    const normalizedAreaId = String(areaId || "").trim();
    if (!normalizedAreaId) return;

    setMeetingSummaries((current) => {
      const next = current.filter((summary) => summary.areaId !== normalizedAreaId);
      if (Array.isArray(users) && users.length) {
        next.push({
          areaId: normalizedAreaId,
          roomId: roomRef.current?.id || "",
          users,
        });
      }
      return next;
    });
  }, []);

  const rebuildRemoteMedia = useCallback((targetUserId) => {
    const bucket = remoteTrackBucketsRef.current.get(targetUserId);
    const media = participantMediaRef.current.get(targetUserId) || {};
    const audioTracks = (bucket?.audio || []).filter((track) => track.readyState !== "ended");
    const videoTracks = (bucket?.video || []).filter((track) => track.readyState !== "ended");

    if (bucket) {
      bucket.audio = audioTracks;
      bucket.video = videoTracks;
    }

    let cameraVideoTracks = videoTracks;
    let screenVideoTracks = [];

    if (media.screenSharing && videoTracks.length) {
      if (media.cameraOff) {
        cameraVideoTracks = [];
        screenVideoTracks = videoTracks.slice(-1);
      } else if (videoTracks.length > 1) {
        cameraVideoTracks = videoTracks.slice(0, 1);
        screenVideoTracks = videoTracks.slice(-1);
      }
    }

    const cameraTracks = [...audioTracks, ...cameraVideoTracks];
    const cameraStream = cameraTracks.length ? new MediaStream(cameraTracks) : null;
    const screenStream = screenVideoTracks.length ? new MediaStream(screenVideoTracks) : null;

    setRemoteStreams((current) => {
      const next = { ...current };
      if (cameraStream) next[targetUserId] = cameraStream;
      else delete next[targetUserId];
      remoteStreamsRef.current = next;
      return next;
    });

    setRemoteScreenStreams((current) => {
      const next = { ...current };
      if (screenStream) next[targetUserId] = screenStream;
      else delete next[targetUserId];
      remoteScreenStreamsRef.current = next;
      return next;
    });
  }, []);

  function emitMediaState(
    nextMedia = mediaState(
      mutedRef.current,
      cameraOffRef.current,
      deafenedRef.current,
      screenSharingRef.current,
    ),
  ) {
    const activeSocket = socketRef.current;
    const activeRoom = roomRef.current;
    const areaId = activeAreaIdRef.current;
    if (!activeSocket?.connected || !activeRoom?.id || !areaId) return;

    activeSocket.emit("meeting:media-state", {
      roomId: activeRoom.id,
      areaId,
      media: nextMedia,
    });
  }

  const clearPeer = useCallback((targetUserId) => {
    const peer = peerConnectionsRef.current.get(targetUserId);
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
    }

    peerConnectionsRef.current.delete(targetUserId);
    remoteTrackBucketsRef.current.delete(targetUserId);
    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[targetUserId];
      remoteStreamsRef.current = next;
      return next;
    });
    setRemoteScreenStreams((current) => {
      const next = { ...current };
      delete next[targetUserId];
      remoteScreenStreamsRef.current = next;
      return next;
    });
  }, []);

  const sendSignal = useCallback((targetUserId, signal) => {
    const activeSocket = socketRef.current;
    const activeRoom = roomRef.current;
    const areaId = activeAreaIdRef.current;
    if (!activeSocket?.connected || !activeRoom?.id || !areaId || !targetUserId || !signal) {
      return;
    }

    activeSocket.emit("meeting:signal", {
      roomId: activeRoom.id,
      areaId,
      targetUserId,
      signal,
    });
  }, []);

  const ensureLocalStream = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraOff(true);
      cameraOffRef.current = true;
      setMediaError("This browser cannot access microphone or camera devices.");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: !cameraOffRef.current,
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mutedRef.current;
      });
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !cameraOffRef.current;
      });
      if (!stream.getVideoTracks().length) {
        cameraOffRef.current = true;
        setCameraOff(true);
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaError("");
      return stream;
    } catch (videoError) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getAudioTracks().forEach((track) => {
          track.enabled = !mutedRef.current;
        });
        localStreamRef.current = stream;
        cameraOffRef.current = true;
        setCameraOff(true);
        setLocalStream(stream);
        setMediaError("Camera is unavailable, so Limeets joined with audio only.");
        return stream;
      } catch {
        cameraOffRef.current = true;
        setCameraOff(true);
        setLocalStream(null);
        setMediaError(
          videoError?.name === "NotAllowedError"
            ? "Camera and microphone permission was blocked."
            : "No microphone or camera is available. You can still appear in the Meeting Area.",
        );
        return null;
      }
    }
  }, []);

  const getPeerConnection = useCallback(
    (targetUserId) => {
      if (!supportsWebRtc()) return null;

      const existing = peerConnectionsRef.current.get(targetUserId);
      if (existing && existing.connectionState !== "closed") {
        ensureReceiveTransceivers(existing);
        return existing;
      }

      const peer = new RTCPeerConnection(PEER_CONFIG);
      const stream = localStreamRef.current;
      if (stream) {
        stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
        stream.getVideoTracks().forEach((track) => peer.addTrack(track, stream));
      }
      if (screenSharingRef.current && screenStreamRef.current) {
        screenStreamRef.current
          .getVideoTracks()
          .forEach((track) => peer.addTrack(track, screenStreamRef.current));
      }
      ensureReceiveTransceivers(peer);

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        sendSignal(targetUserId, {
          type: "ice",
          candidate: event.candidate.toJSON(),
        });
      };

      peer.ontrack = (event) => {
        const bucket = remoteTrackBucketsRef.current.get(targetUserId) || {
          audio: [],
          video: [],
        };
        remoteTrackBucketsRef.current.set(targetUserId, bucket);

        const trackList = event.track.kind === "audio" ? bucket.audio : bucket.video;
        if (!trackList.some((track) => track.id === event.track.id)) {
          trackList.push(event.track);
        }

        event.track.onended = () => {
          const currentBucket = remoteTrackBucketsRef.current.get(targetUserId);
          if (!currentBucket) return;
          currentBucket.audio = currentBucket.audio.filter((track) => track.id !== event.track.id);
          currentBucket.video = currentBucket.video.filter((track) => track.id !== event.track.id);
          rebuildRemoteMedia(targetUserId);
        };

        rebuildRemoteMedia(targetUserId);
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          clearPeer(targetUserId);
        }
      };

      peerConnectionsRef.current.set(targetUserId, peer);
      return peer;
    },
    [clearPeer, rebuildRemoteMedia, sendSignal],
  );

  const startOffer = useCallback(
    async (targetUserId) => {
      await ensureLocalStream();
      const peer = getPeerConnection(targetUserId);
      if (!peer) return;

      ensureReceiveTransceivers(peer);
      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await peer.setLocalDescription(offer);
      sendSignal(targetUserId, {
        type: "offer",
        sdp: offer.sdp,
      });
    },
    [ensureLocalStream, getPeerConnection, sendSignal],
  );

  const renegotiatePeer = useCallback(
    async (targetUserId) => {
      const peer = peerConnectionsRef.current.get(targetUserId);
      if (!peer || peer.connectionState === "closed") return;

      try {
        ensureReceiveTransceivers(peer);
        const offer = await peer.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        await peer.setLocalDescription(offer);
        sendSignal(targetUserId, {
          type: "offer",
          sdp: offer.sdp,
        });
      } catch {
        setMediaError("Meeting connection is retrying. If it persists, leave and re-enter the area.");
      }
    },
    [sendSignal],
  );

  const addLocalTrackToPeers = useCallback(
    (track, stream) => {
      peerConnectionsRef.current.forEach((peer, targetUserId) => {
        const screenTrackIds = new Set(
          screenStreamRef.current?.getVideoTracks?.().map((screenTrack) => screenTrack.id) || [],
        );
        const sender =
          peer
            .getSenders?.()
            .find(
              (candidate) =>
                candidate.track?.kind === track.kind &&
                (track.kind !== "video" || !screenTrackIds.has(candidate.track.id)),
            ) ||
          peer
            .getTransceivers?.()
            .find(
              (transceiver) =>
                !transceiver.sender?.track && transceiver.receiver?.track?.kind === track.kind,
            )?.sender;
        if (sender) {
          void sender.replaceTrack(track);
          const transceiver = peer
            .getTransceivers?.()
            .find((candidate) => candidate.sender === sender);
          if (transceiver && transceiver.direction === "recvonly") {
            transceiver.direction = "sendrecv";
          }
        } else {
          peer.addTrack(track, stream);
        }
        void renegotiatePeer(targetUserId);
      });
    },
    [renegotiatePeer],
  );

  const addScreenTrackToPeers = useCallback(
    (track, stream) => {
      peerConnectionsRef.current.forEach((peer, targetUserId) => {
        peer.addTrack(track, stream);
        void renegotiatePeer(targetUserId);
      });
    },
    [renegotiatePeer],
  );

  const leaveMeeting = useCallback(() => {
    const activeSocket = socketRef.current;
    const activeRoom = roomRef.current;
    const areaId = activeAreaIdRef.current;

    if (activeSocket?.connected && activeRoom?.id && areaId) {
      activeSocket.emit("meeting:leave", {
        roomId: activeRoom.id,
        areaId,
      });
    }
    upsertMeetingSummary(areaId, []);

    Array.from(peerConnectionsRef.current.keys()).forEach((targetUserId) => clearPeer(targetUserId));
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    localStreamRef.current = null;
    screenStreamRef.current = null;
    screenSharingRef.current = false;
    activeAreaIdRef.current = "";
    setActiveAreaId("");
    setJoining(false);
    setLocalStream(null);
    setMediaError("");
    setParticipants([]);
    setRemoteStreams({});
    setRemoteScreenStreams({});
    setScreenSharing(false);
    setScreenStream(null);
  }, [clearPeer, upsertMeetingSummary]);

  const joinMeeting = useCallback(
    async (areaIdValue) => {
      const areaId = String(areaIdValue || "").trim();
      const activeRoom = roomRef.current;
      const activeSocket = socketRef.current;
      if (!areaId || !activeRoom?.id) return;

      if (activeAreaIdRef.current === areaId) return;
      if (activeAreaIdRef.current) leaveMeeting();

      activeAreaIdRef.current = areaId;
      setActiveAreaId(areaId);
      setJoining(true);
      await ensureLocalStream();

      const nextMedia = mediaState(
        mutedRef.current,
        cameraOffRef.current,
        deafenedRef.current,
        screenSharingRef.current,
      );
      const fallbackUsers = [
        localParticipant(activeRoom, areaId, userRef.current, nextMedia, profileStatusRef.current),
      ];

      if (!activeSocket?.connected) {
        setParticipants(fallbackUsers);
        upsertMeetingSummary(areaId, fallbackUsers);
        setMediaError((current) => current || "Socket is offline. You are visible locally only.");
        setJoining(false);
        return;
      }

      activeSocket.emit(
        "meeting:join",
        {
          roomId: activeRoom.id,
          areaId,
          media: nextMedia,
          profileStatus: profileStatusRef.current,
        },
        (ack) => {
          if (activeAreaIdRef.current !== areaId) return;
          setJoining(false);

          if (!ack?.ok) {
            setParticipants(fallbackUsers);
            setMediaError(ack?.message || "Unable to join the Meeting Area.");
            return;
          }

          const users = Array.isArray(ack.users) ? ack.users : fallbackUsers;
          rememberParticipantMedia(users);
          setParticipants(users);
          if (Array.isArray(ack.meetings)) {
            setMeetingSummaries(normalizeMeetingSummaries(ack.meetings));
          } else {
            upsertMeetingSummary(areaId, users);
          }
          users
            .filter((participant) => participant?.userId && participant.userId !== userRef.current?.id)
            .forEach((participant) => {
              void startOffer(participant.userId);
            });
        },
      );
    },
    [ensureLocalStream, leaveMeeting, startOffer, upsertMeetingSummary],
  );

  useEffect(() => {
    const activeSocket = socket;
    if (!activeSocket) return undefined;

    function handleMeetingState(payload) {
      if (
        payload?.roomId !== roomRef.current?.id ||
        payload?.areaId !== activeAreaIdRef.current ||
        !Array.isArray(payload.users)
      ) {
        return;
      }

      rememberParticipantMedia(payload.users);
      payload.users.forEach((participant) => {
        if (participant?.userId) rebuildRemoteMedia(participant.userId);
      });
      setParticipants(payload.users);
      upsertMeetingSummary(payload.areaId, payload.users);
    }

    function handleUserJoined(payload) {
      if (payload?.roomId !== roomRef.current?.id || payload?.areaId !== activeAreaIdRef.current) {
        return;
      }

      rememberParticipantMedia([payload]);
      rebuildRemoteMedia(payload.userId);
      setParticipants((current) => {
        const next = [
          ...current.filter((participant) => participant.userId !== payload.userId),
          payload,
        ];
        upsertMeetingSummary(payload.areaId, next);
        return next;
      });
    }

    function handleUserLeft(payload) {
      if (payload?.roomId !== roomRef.current?.id || payload?.areaId !== activeAreaIdRef.current) {
        return;
      }

      clearPeer(payload.userId);
      setParticipants((current) =>
        {
          const next = current.filter((participant) => participant.userId !== payload.userId);
          upsertMeetingSummary(payload.areaId, next);
          return next;
        },
      );
    }

    function handleUserMedia(payload) {
      if (payload?.roomId !== roomRef.current?.id || payload?.areaId !== activeAreaIdRef.current) {
        return;
      }

      rememberParticipantMedia([{ userId: payload.userId, media: payload.media }]);
      rebuildRemoteMedia(payload.userId);
      setParticipants((current) =>
        {
          const next = current.map((participant) =>
            participant.userId === payload.userId
              ? { ...participant, media: payload.media || participant.media }
              : participant,
          );
          upsertMeetingSummary(payload.areaId, next);
          return next;
        },
      );
      if (!payload.media?.screenSharing) {
        setRemoteScreenStreams((current) => {
          const next = { ...current };
          delete next[payload.userId];
          remoteScreenStreamsRef.current = next;
          return next;
        });
      }
    }

    async function handleSignal(payload) {
      if (
        payload?.roomId !== roomRef.current?.id ||
        payload?.areaId !== activeAreaIdRef.current ||
        payload?.fromUserId === userRef.current?.id
      ) {
        return;
      }

      await ensureLocalStream();
      const peer = getPeerConnection(payload.fromUserId);
      const signal = payload.signal || {};
      if (!peer) return;

      try {
        if (signal.type === "offer" && signal.sdp) {
          await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendSignal(payload.fromUserId, { type: "answer", sdp: answer.sdp });
        } else if (signal.type === "answer" && signal.sdp) {
          await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        } else if (signal.type === "ice" && signal.candidate) {
          await peer.addIceCandidate(signal.candidate);
        }
      } catch {
        setMediaError("Meeting connection is retrying. If it persists, leave and re-enter the area.");
      }
    }

    function handleMeetingSummary(payload) {
      if (payload?.roomId !== roomRef.current?.id) return;
      setMeetingSummaries(normalizeMeetingSummaries(payload.areas));
    }

    function handleProfileUpdated(payload) {
      if (payload?.roomId !== roomRef.current?.id || !payload.user?.id) return;
      const nextUser = payload.user;
      setParticipants((current) =>
        current.map((participant) => mergeParticipantProfile(participant, nextUser)),
      );
      setMeetingSummaries((current) =>
        current.map((summary) => ({
          ...summary,
          users: summary.users.map((participant) => mergeParticipantProfile(participant, nextUser)),
        })),
      );
    }

    activeSocket.on("meeting:state", handleMeetingState);
    activeSocket.on("meeting:summary", handleMeetingSummary);
    activeSocket.on("meeting:user-joined", handleUserJoined);
    activeSocket.on("meeting:user-left", handleUserLeft);
    activeSocket.on("meeting:user-media", handleUserMedia);
    activeSocket.on("meeting:signal", handleSignal);
    activeSocket.on("user:profile-updated", handleProfileUpdated);

    return () => {
      activeSocket.off("meeting:state", handleMeetingState);
      activeSocket.off("meeting:summary", handleMeetingSummary);
      activeSocket.off("meeting:user-joined", handleUserJoined);
      activeSocket.off("meeting:user-left", handleUserLeft);
      activeSocket.off("meeting:user-media", handleUserMedia);
      activeSocket.off("meeting:signal", handleSignal);
      activeSocket.off("user:profile-updated", handleProfileUpdated);
    };
  }, [clearPeer, ensureLocalStream, getPeerConnection, rebuildRemoteMedia, sendSignal, socket, upsertMeetingSummary]);

  useEffect(() => () => leaveMeeting(), [leaveMeeting]);

  const toggleMuted = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    emitMediaState(
      mediaState(nextMuted, cameraOffRef.current, deafenedRef.current, screenSharingRef.current),
    );
  }, []);

  const toggleCamera = useCallback(() => {
    async function enableMissingCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError("This browser cannot access camera devices.");
        emitMediaState(
          mediaState(mutedRef.current, true, deafenedRef.current, screenSharingRef.current),
        );
        return;
      }

      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        const [videoTrack] = videoStream.getVideoTracks();
        if (!videoTrack) throw new Error("No camera track returned.");

        const currentStream = localStreamRef.current || new MediaStream();
        currentStream.addTrack(videoTrack);
        videoTrack.enabled = true;

        const nextStream = new MediaStream(currentStream.getTracks());
        localStreamRef.current = nextStream;
        cameraOffRef.current = false;
        setCameraOff(false);
        setLocalStream(nextStream);
        setMediaError("");
        addLocalTrackToPeers(videoTrack, nextStream);
        emitMediaState(
          mediaState(mutedRef.current, false, deafenedRef.current, screenSharingRef.current),
        );
      } catch {
        cameraOffRef.current = true;
        setCameraOff(true);
        setMediaError("Camera is unavailable on this device.");
        emitMediaState(
          mediaState(mutedRef.current, true, deafenedRef.current, screenSharingRef.current),
        );
      }
    }

    const videoTracks = localStreamRef.current?.getVideoTracks?.() || [];
    if (!videoTracks.length && cameraOffRef.current) {
      void enableMissingCamera();
      return;
    }

    const nextCameraOff = !cameraOffRef.current;
    cameraOffRef.current = nextCameraOff;
    setCameraOff(nextCameraOff);
    videoTracks.forEach((track) => {
      track.enabled = !nextCameraOff;
    });
    if (!nextCameraOff) {
      videoTracks.forEach((track) => {
        const stream = localStreamRef.current;
        if (stream) addLocalTrackToPeers(track, stream);
      });
    }
    emitMediaState(
      mediaState(mutedRef.current, nextCameraOff, deafenedRef.current, screenSharingRef.current),
    );
  }, [addLocalTrackToPeers]);

  const toggleDeafened = useCallback(() => {
    const nextDeafened = !deafenedRef.current;
    deafenedRef.current = nextDeafened;
    setDeafened(nextDeafened);
    emitMediaState(
      mediaState(mutedRef.current, cameraOffRef.current, nextDeafened, screenSharingRef.current),
    );
  }, []);

  const stopScreenShare = useCallback(() => {
    const currentScreen = screenStreamRef.current;
    if (!currentScreen && !screenSharingRef.current) return;

    currentScreen?.getTracks().forEach((track) => {
      track.onended = null;
      peerConnectionsRef.current.forEach((peer, targetUserId) => {
        peer
          .getSenders?.()
          .filter((sender) => sender.track?.id === track.id)
          .forEach((sender) => peer.removeTrack(sender));
        void renegotiatePeer(targetUserId);
      });
      track.stop();
    });
    screenStreamRef.current = null;
    screenSharingRef.current = false;
    setScreenStream(null);
    setScreenSharing(false);

    emitMediaState(mediaState(mutedRef.current, cameraOffRef.current, deafenedRef.current, false));
  }, [renegotiatePeer]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharingRef.current) {
      stopScreenShare();
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaError("This browser cannot share your screen.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
      const [screenTrack] = stream.getVideoTracks();
      if (!screenTrack) throw new Error("No screen track returned.");

      screenTrack.onended = () => stopScreenShare();
      screenStreamRef.current = stream;
      screenSharingRef.current = true;
      setScreenStream(stream);
      setScreenSharing(true);
      setMediaError("");
      addScreenTrackToPeers(screenTrack, stream);
      emitMediaState(mediaState(mutedRef.current, cameraOffRef.current, deafenedRef.current, true));
    } catch {
      screenStreamRef.current = null;
      screenSharingRef.current = false;
      setScreenStream(null);
      setScreenSharing(false);
      setMediaError("Screen sharing could not start.");
      emitMediaState(mediaState(mutedRef.current, cameraOffRef.current, deafenedRef.current, false));
    }
  }, [addScreenTrackToPeers, stopScreenShare]);

  const visibleParticipants = useMemo(() => {
    if (!activeAreaId) return [];

    const selfId = user?.id || "local-user";
    const hasSelf = participants.some((participant) => participant.userId === selfId);
    const nextMedia = mediaState(muted, cameraOff, deafened, screenSharing);
    return hasSelf
      ? participants
      : [localParticipant(room, activeAreaId, user, nextMedia, profileStatus), ...participants];
  }, [activeAreaId, cameraOff, deafened, muted, participants, profileStatus, room, screenSharing, user]);

  return {
    activeAreaId,
    cameraOff,
    deafened,
    displayName: displayName(user),
    isActive: Boolean(activeAreaId),
    joining,
    joinMeeting,
    leaveMeeting,
    localStream,
    mediaError,
    meetings: meetingSummaries,
    muted,
    participants: visibleParticipants,
    remoteScreenStreams,
    remoteStreams,
    screenSharing,
    screenStream,
    toggleCamera,
    toggleDeafened,
    toggleMuted,
    toggleScreenShare,
  };
}
