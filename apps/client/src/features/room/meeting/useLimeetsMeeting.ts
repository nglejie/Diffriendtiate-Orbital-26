import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PEER_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function displayName(user) {
  return user?.name || user?.displayName || user?.email || "You";
}

function localParticipant(room, areaId, user, media) {
  return {
    areaId,
    joinedAt: new Date().toISOString(),
    media,
    roomId: room?.id || "",
    user,
    userId: user?.id || "local-user",
  };
}

function mediaState(muted, cameraOff, deafened) {
  return { muted, cameraOff, deafened };
}

function supportsWebRtc() {
  return typeof RTCPeerConnection !== "undefined";
}

function hasTransceiverForKind(peer, kind) {
  return peer
    .getTransceivers?.()
    .some(
      (transceiver) =>
        transceiver.sender?.track?.kind === kind ||
        transceiver.receiver?.track?.kind === kind,
    );
}

function ensureReceiveTransceivers(peer) {
  if (!peer?.addTransceiver || !peer.getTransceivers) return;
  if (!hasTransceiverForKind(peer, "audio")) {
    peer.addTransceiver("audio", { direction: "recvonly" });
  }
  if (!hasTransceiverForKind(peer, "video")) {
    peer.addTransceiver("video", { direction: "recvonly" });
  }
}

export function useLimeetsMeeting({ room, socket, user }) {
  const [activeAreaId, setActiveAreaId] = useState("");
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [mediaError, setMediaError] = useState("");
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [deafened, setDeafened] = useState(false);

  const activeAreaIdRef = useRef("");
  const cameraOffRef = useRef(false);
  const deafenedRef = useRef(false);
  const localStreamRef = useRef(null);
  const mutedRef = useRef(false);
  const peerConnectionsRef = useRef(new Map());
  const roomRef = useRef(room);
  const socketRef = useRef(socket);
  const userRef = useRef(user);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  function emitMediaState(nextMedia = mediaState(mutedRef.current, cameraOffRef.current, deafenedRef.current)) {
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
    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[targetUserId];
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !mutedRef.current;
      });
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !cameraOffRef.current;
      });
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
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
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
        const streamFromTrack = event.streams?.[0] || new MediaStream([event.track]);
        setRemoteStreams((current) => ({
          ...current,
          [targetUserId]: streamFromTrack,
        }));
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          clearPeer(targetUserId);
        }
      };

      peerConnectionsRef.current.set(targetUserId, peer);
      return peer;
    },
    [clearPeer, sendSignal],
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
        const sender =
          peer.getSenders?.().find((candidate) => candidate.track?.kind === track.kind) ||
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

    Array.from(peerConnectionsRef.current.keys()).forEach((targetUserId) => clearPeer(targetUserId));
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    activeAreaIdRef.current = "";
    setActiveAreaId("");
    setJoining(false);
    setLocalStream(null);
    setMediaError("");
    setParticipants([]);
    setRemoteStreams({});
  }, [clearPeer]);

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

      const nextMedia = mediaState(mutedRef.current, cameraOffRef.current, deafenedRef.current);
      const fallbackUsers = [localParticipant(activeRoom, areaId, userRef.current, nextMedia)];

      if (!activeSocket?.connected) {
        setParticipants(fallbackUsers);
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
          setParticipants(users);
          users
            .filter((participant) => participant?.userId && participant.userId !== userRef.current?.id)
            .forEach((participant) => {
              void startOffer(participant.userId);
            });
        },
      );
    },
    [ensureLocalStream, leaveMeeting, startOffer],
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

      setParticipants(payload.users);
    }

    function handleUserJoined(payload) {
      if (payload?.roomId !== roomRef.current?.id || payload?.areaId !== activeAreaIdRef.current) {
        return;
      }

      setParticipants((current) => [
        ...current.filter((participant) => participant.userId !== payload.userId),
        payload,
      ]);
    }

    function handleUserLeft(payload) {
      if (payload?.roomId !== roomRef.current?.id || payload?.areaId !== activeAreaIdRef.current) {
        return;
      }

      clearPeer(payload.userId);
      setParticipants((current) =>
        current.filter((participant) => participant.userId !== payload.userId),
      );
    }

    function handleUserMedia(payload) {
      if (payload?.roomId !== roomRef.current?.id || payload?.areaId !== activeAreaIdRef.current) {
        return;
      }

      setParticipants((current) =>
        current.map((participant) =>
          participant.userId === payload.userId
            ? { ...participant, media: payload.media || participant.media }
            : participant,
        ),
      );
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

    activeSocket.on("meeting:state", handleMeetingState);
    activeSocket.on("meeting:user-joined", handleUserJoined);
    activeSocket.on("meeting:user-left", handleUserLeft);
    activeSocket.on("meeting:user-media", handleUserMedia);
    activeSocket.on("meeting:signal", handleSignal);

    return () => {
      activeSocket.off("meeting:state", handleMeetingState);
      activeSocket.off("meeting:user-joined", handleUserJoined);
      activeSocket.off("meeting:user-left", handleUserLeft);
      activeSocket.off("meeting:user-media", handleUserMedia);
      activeSocket.off("meeting:signal", handleSignal);
    };
  }, [clearPeer, ensureLocalStream, getPeerConnection, sendSignal, socket]);

  useEffect(() => () => leaveMeeting(), [leaveMeeting]);

  const toggleMuted = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    emitMediaState(mediaState(nextMuted, cameraOffRef.current, deafenedRef.current));
  }, []);

  const toggleCamera = useCallback(() => {
    async function enableMissingCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError("This browser cannot access camera devices.");
        emitMediaState(mediaState(mutedRef.current, true, deafenedRef.current));
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
        emitMediaState(mediaState(mutedRef.current, false, deafenedRef.current));
      } catch {
        cameraOffRef.current = true;
        setCameraOff(true);
        setMediaError("Camera is unavailable on this device.");
        emitMediaState(mediaState(mutedRef.current, true, deafenedRef.current));
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
    emitMediaState(mediaState(mutedRef.current, nextCameraOff, deafenedRef.current));
  }, [addLocalTrackToPeers]);

  const toggleDeafened = useCallback(() => {
    const nextDeafened = !deafenedRef.current;
    deafenedRef.current = nextDeafened;
    setDeafened(nextDeafened);
    emitMediaState(mediaState(mutedRef.current, cameraOffRef.current, nextDeafened));
  }, []);

  const visibleParticipants = useMemo(() => {
    if (!activeAreaId) return [];

    const selfId = user?.id || "local-user";
    const hasSelf = participants.some((participant) => participant.userId === selfId);
    const nextMedia = mediaState(muted, cameraOff, deafened);
    return hasSelf
      ? participants
      : [localParticipant(room, activeAreaId, user, nextMedia), ...participants];
  }, [activeAreaId, cameraOff, deafened, muted, participants, room, user]);

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
    muted,
    participants: visibleParticipants,
    remoteStreams,
    toggleCamera,
    toggleDeafened,
    toggleMuted,
  };
}
