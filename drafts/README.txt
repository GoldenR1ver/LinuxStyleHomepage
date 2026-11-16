Drafts, not pages
=================

Put anything unfinished in this directory. It is the one place that is both
ignored by git and absent from the built site.

Start every draft with this line
--------------------------------

    DRAFT: unpublished

That marker is the contract. A text file under content/ whose first five lines
carry it stops the build with G-DRAFT-01, and `npm run dev` warns about it. So a
leaked draft cannot slide into a deploy by habit; publishing takes a deliberate
act: copy the draft into content/ and delete the marker line.

Why here
  The site is built by walking content/ only. A file under content/ is a page
  the moment it is committed, because the build turns every file into a static
  asset with a public URL. A file here has no URL at all.

What is ignored
  Everything except this file. The .gitignore rule is:

    drafts/*
    !drafts/README.txt

  So a draft cannot reach main by accident, and it cannot reach dist/ at all.

Why chmod does not help
  The shell has mode bits and a chmod command, but chmod is not access control:
    - it writes a mode into this browser's overlay only, never into a commit;
    - the build stores no mode, so every visitor gets 0644 again;
    - the built file is a public asset, so its URL answers with the bytes
      whether or not the terminal would refuse to cat it.
  Use this directory, or a private branch, or a separate private repository.

Moving a draft into the site
  Copy it to content/ and delete the marker line, then commit. That is the
  moment it becomes public.
