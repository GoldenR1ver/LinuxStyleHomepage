reading room

Only members of the readers group may open this directory. That is a real
check: the directory is 0750 root:readers, so a visitor outside the group gets
EACCES on the directory itself, not on this file.

    id            asks /etc/group which groups you are in
    ls -ld /srv   shows the owner and the mode
