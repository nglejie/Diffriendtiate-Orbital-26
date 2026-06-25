import { describe, expect, it } from "vitest";
import {
  buildResourceStats,
  enrichResources,
  filterResources,
  inferResourceTopic,
  inferResourceType,
  normalizeResourceName,
} from "./resourceWorkspace.js";

const room = {
  moduleCode: "CS2100",
  academicTerm: "AY2026/2027 Sem 1",
};

describe("resourceWorkspace", () => {
  it("normalizes resource names for duplicate/version detection", () => {
    expect(normalizeResourceName("CS2100 Lecture 02 v3.pdf")).toBe("cs2100 lecture 02");
  });

  it("infers resource type and topic from filenames", () => {
    const resource = {
      title: "CS2100 Tutorial 4 Boolean Algebra.pdf",
      folder: "Tutorials",
    };

    expect(inferResourceType(resource)).toBe("Tutorial");
    expect(inferResourceTopic(resource, room)).toBe("4 boolean algebra");
  });

  it("enriches resources with searchable metadata", () => {
    const [resource] = enrichResources(
      [
        {
          id: "res_1",
          title: "Lecture 7 CPU datapath.pdf",
          folder: "Lecture Notes",
          uploader: { name: "Fleming" },
        },
      ],
      room,
    );

    expect(resource.displayName).toBe("Lecture 7 CPU datapath.pdf");
    expect(resource.metadata).toMatchObject({
      contributor: "Fleming",
      module: "CS2100",
      resourceType: "Lecture Notes",
      semester: "AY2026/2027 Sem 1",
      version: "v1",
    });
    expect(resource.searchText).toContain("cpu datapath");
  });

  it("filters resources by folder, type, and query", () => {
    const resources = enrichResources(
      [
        { id: "res_1", title: "Lecture 1 Intro.pdf", folder: "Lecture Notes" },
        { id: "res_2", title: "Tutorial 1 worksheet.pdf", folder: "Tutorials" },
      ],
      room,
    );

    expect(filterResources(resources, { folder: "Tutorials", type: "Tutorial", query: "worksheet" }))
      .toHaveLength(1);
    expect(filterResources(resources, { folder: "Tutorials", type: "Lecture Notes" }))
      .toHaveLength(0);
  });

  it("summarizes resource library counts", () => {
    const resources = enrichResources(
      [
        { id: "res_1", title: "Lecture 1.pdf", folder: "Lecture Notes" },
        { id: "res_2", title: "Lecture 1 v2.pdf", folder: "Lecture Notes" },
        { id: "res_3", title: "Tutorial 1.pdf", folder: "Tutorials" },
      ],
      room,
    );

    expect(buildResourceStats(resources)).toEqual({
      total: 3,
      types: 2,
      duplicates: 1,
    });
  });
});
