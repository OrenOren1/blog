---
title: "Picture URL smoke test (ImgBB in post body)"
meta_title: "ImgBB inline image smoke test"
description: "Confirms markdown image URLs from ImgBB render in the Astro blog post page."
date: 2026-05-12T12:00:00+00:00
image: "https://i.ibb.co/prMR0y4t/Gemini-Generated-Image-kh3sz2kh3sz2kh3s.png"
categories:
  - "DevOps"
tags:
  - "test"
draft: false
author: "Oren Sultan"
---

## What this page is for

This post exists so you can **confirm ImgBB URLs in markdown** show up as images in the blog UI (hero + inline).

### Hero

The Open Graph / card image comes from front matter `image:` — same host as below.

### Inline images (URLs inserted like `npm run blog:images` does)

![Sample wide diagram from ImgBB (Helm / OpenShift post asset)](https://i.ibb.co/prMR0y4t/Gemini-Generated-Image-kh3sz2kh3sz2kh3s.png)

![Sample hero-style still from ImgBB (Strimzi CDC post asset)](https://i.ibb.co/nNYcqYkn/strimzi-debezium-cdc-e2e-hero.png)

If you see **two** images above plus the hero, URL insertion and rendering are working.
