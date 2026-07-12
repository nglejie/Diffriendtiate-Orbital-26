import { useMemo, useState } from "react";
import { Check, ChevronDown, Crown, Link as LinkIcon, MonitorUp, Users } from "lucide-react";
import { normalizeProfileStatus } from "../profile/UserProfileControls.tsx";

const ACTIVITY_LABELS = {
  buddy: "Intelligrate",
  calendar: "Coordidate",
  chat: "Convolution",
  focus: "Domain",
  meetings: "Limeets",
  resources: "Infilenite",
  space: "Domain",
};

function getInitial(value) {
  return String(value || "?").trim().charAt(0).toUpperCase() || "?";
}

function getDisplayName(user) {
  return user?.name || user?.displayName || user?.email || "Member";
}

function avatarUrl(user) {
  return user?.avatarUrl || user?.avatar || user?.photoUrl || "";
}

function MiniAvatar({ user, active = true, owner = false, showStatus = true, status = "offline" }) {
  const displayName = getDisplayName(user);
  const statusClass = active ? normalizeProfileStatus(status) : "offline";
  return (
    <span className="limeets-sidebar-avatar" aria-hidden="true">
      {avatarUrl(user) ? <img src={avatarUrl(user)} alt="" /> : getInitial(displayName)}
      {owner ? (
        <span className="member-owner-crown">
          <Crown size={12} fill="currentColor" />
        </span>
      ) : null}
      {showStatus ? <i className={statusClass} /> : null}
    </span>
  );
}

function getMeetingAreaName(room, areaId) {
  const areas = Array.isArray(room?.worldConfig?.privateAreas) ? room.worldConfig.privateAreas : [];
  const area = areas.find((candidate) => candidate?.id === areaId);
  return area?.name || area?.label || "Meeting Area";
}

function buildMeetingSummaries(room, meeting) {
  const summaries = new Map();

  (meeting?.meetings || []).forEach((summary) => {
    if (!summary?.areaId || !Array.isArray(summary.users) || !summary.users.length) return;
    summaries.set(summary.areaId, {
      areaId: summary.areaId,
      name: getMeetingAreaName(room, summary.areaId),
      participants: summary.users,
    });
  });

  if (meeting?.isActive && meeting?.activeAreaId && Array.isArray(meeting.participants) && meeting.participants.length) {
    summaries.set(meeting.activeAreaId, {
      areaId: meeting.activeAreaId,
      name: getMeetingAreaName(room, meeting.activeAreaId),
      participants: meeting.participants,
    });
  }

  return Array.from(summaries.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function buildRoomMembers(room, activityMembers, meetingSummaries, currentUser, currentProfileStatus) {
  const merged = new Map();
  const activityByUser = new Map();
  const meetingByUser = new Map();
  const owner = room?.owner || {};
  const ownProfileStatus = normalizeProfileStatus(currentProfileStatus);

  activityMembers.forEach((member) => {
    if (!member?.userId) return;
    activityByUser.set(member.userId, member);
  });

  meetingSummaries.forEach((summary) => {
    summary.participants.forEach((participant) => {
      if (!participant?.userId) return;
      meetingByUser.set(participant.userId, {
        ...participant,
        areaName: summary.name,
      });
    });
  });

  if (owner.id) {
    merged.set(owner.id, {
      owner: true,
      user: owner,
      userId: owner.id,
    });
  }

  (room?.members || []).forEach((member) => {
    if (!member?.id) return;
    merged.set(member.id, {
      owner: member.id === owner.id,
      user: member,
      userId: member.id,
    });
  });

  meetingSummaries.forEach((summary) => {
    summary.participants.forEach((participant) => {
      if (!participant?.userId) return;
      merged.set(participant.userId, {
        ...merged.get(participant.userId),
        user: participant.user || merged.get(participant.userId)?.user,
        userId: participant.userId,
      });
    });
  });

  if (currentUser?.id && !merged.has(currentUser.id)) {
    merged.set(currentUser.id, {
      tabId: "space",
      user: currentUser,
      userId: currentUser.id,
    });
  }

  return Array.from(merged.values())
    .map((member) => {
      const activity = activityByUser.get(member.userId);
      const meetingParticipant = meetingByUser.get(member.userId);
      const profileStatus =
        member.userId === currentUser?.id
          ? ownProfileStatus
          : normalizeProfileStatus(activity?.profileStatus || meetingParticipant?.profileStatus || "online");
      const invisible = profileStatus === "invisible";
      const online = !invisible && Boolean(activity || meetingParticipant || member.userId === currentUser?.id);
      const tabId = meetingParticipant ? "meetings" : activity?.tabId || member.tabId || "";

      return {
        ...member,
        inMeeting: Boolean(meetingParticipant),
        meetingAreaName: meetingParticipant?.areaName || "",
        online,
        owner: Boolean(member.owner || member.userId === owner.id),
        profileStatus: online ? profileStatus : "offline",
        tabId,
      };
    })
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      if (a.owner !== b.owner) return a.owner ? -1 : 1;
      return getDisplayName(a.user).localeCompare(getDisplayName(b.user));
    });
}

export function MeetingSidebarPanel({
  copyInviteLink,
  currentProfileStatus,
  inviteCopied,
  meeting,
  onOpenMeeting,
  room,
  roomActivityMembers = [],
  user,
}) {
  const [limeetsOpen, setLimeetsOpen] = useState(true);
  const [membersOpen, setMembersOpen] = useState(true);
  const meetingSummaries = useMemo(() => buildMeetingSummaries(room, meeting), [meeting, room]);
  const members = useMemo(
    () => buildRoomMembers(room, roomActivityMembers, meetingSummaries, user, currentProfileStatus),
    [currentProfileStatus, meetingSummaries, room, roomActivityMembers, user],
  );
  const hasMeetings = meetingSummaries.length > 0;

  return (
    <section className="limeets-meeting-panel info" aria-label="Domain meeting information">
      <button
        className="room-invite-button"
        disabled={!room?.inviteCode}
        onClick={copyInviteLink}
        title={inviteCopied ? "Link copied" : "Copy invite link"}
        type="button"
      >
        <span>
          <Users size={18} />
          Invite
        </span>
        <span className="invite-link-state">
          {inviteCopied ? <Check size={18} /> : <LinkIcon size={17} />}
        </span>
      </button>

      {hasMeetings ? (
        <section className="limeets-sidebar-section">
          <button
            aria-expanded={limeetsOpen}
            className="limeets-sidebar-section-heading toggle"
            onClick={() => setLimeetsOpen((open) => !open)}
            type="button"
          >
            <ChevronDown size={14} />
            <span>Limeets</span>
            <MonitorUp size={15} />
          </button>
          {limeetsOpen ? (
            <div className="limeets-meeting-summary-list">
              {meetingSummaries.map((summary) => (
                <button
                  aria-label={`Open ${summary.name} in Limeets`}
                  className="limeets-meeting-summary"
                  key={summary.areaId}
                  onClick={() => onOpenMeeting?.(summary)}
                  type="button"
                >
                  <strong>{summary.name}</strong>
                  <div className="limeets-meeting-avatar-stack" aria-label={`${summary.name} members`}>
                    {summary.participants.slice(0, 5).map((participant) => (
                      <MiniAvatar
                        key={participant.userId}
                        showStatus={false}
                        user={participant.user}
                      />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="limeets-sidebar-section">
        <button
          aria-expanded={membersOpen}
          className="limeets-sidebar-section-heading toggle"
          onClick={() => setMembersOpen((open) => !open)}
          type="button"
        >
          <ChevronDown size={14} />
          <span>Members ({members.length})</span>
          <Users size={15} />
        </button>
        {membersOpen ? (
          <div className="limeets-online-list">
            {members.map((member) => (
              <article
                key={member.userId}
                className={`limeets-online-member ${member.online ? "online" : "offline"}`}
              >
                <MiniAvatar
                  active={member.online}
                  owner={member.owner}
                  status={member.profileStatus}
                  user={member.user}
                />
                <div>
                  <strong>{getDisplayName(member.user)}</strong>
                  <span>
                    {member.online
                      ? member.inMeeting
                        ? `In ${member.meetingAreaName || "Limeets"}`
                        : `In ${ACTIVITY_LABELS[member.tabId] || "Domain"}`
                      : "Offline"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </section>
  );
}
