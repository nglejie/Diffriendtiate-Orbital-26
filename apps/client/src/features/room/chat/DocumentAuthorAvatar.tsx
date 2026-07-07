import { getInitial } from "../../../shared/utils/room.ts";

function avatarUrl(user: any) {
  return user?.avatarUrl || user?.avatar || user?.photoUrl || "";
}

export function mergeCurrentUserProfile(author: any, currentUser: any) {
  if (!author || author.id !== currentUser?.id) return author || {};

  return {
    ...author,
    ...currentUser,
    avatarUrl: avatarUrl(currentUser) || avatarUrl(author),
  };
}

export function DocumentAuthorAvatar({
  author,
  currentUser,
  small = false,
}: {
  author: any;
  currentUser?: any;
  small?: boolean;
}) {
  const profile = mergeCurrentUserProfile(author, currentUser);
  const displayName = profile?.name || profile?.email || "Unknown";
  const photo = avatarUrl(profile);
  const className = `document-annotation-avatar ${small ? "small" : ""}`.trim();

  if (photo) {
    return (
      <span className={`${className} image`}>
        <img alt={`${displayName} profile picture`} src={photo} />
      </span>
    );
  }

  return <span className={className}>{getInitial(displayName)}</span>;
}
