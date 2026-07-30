/** Synthetic runtime contract used only to test client-schema plumbing. */
function schemaForAction(actionType = "notify") {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    required: ["id", "name", "description", "goals"],
    properties: {
      id: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
      description: { type: "string" },
      goals: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "name", "trigger", "action"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            trigger: { type: "object", required: ["type"] },
            action: { $ref: "#/definitions/GoalAction" },
          },
        },
      },
    },
    definitions: {
      GoalAction: {
        type: "object",
        required: ["type"],
        oneOf: [
          {
            type: "object",
            properties: {
              type: { const: actionType },
              message: { type: "string" },
            },
            required: ["type", "message"],
          },
          {
            type: "object",
            properties: {
              type: { const: "tap" },
              target: { $ref: "#/definitions/Target" },
            },
            required: ["type", "target"],
          },
        ],
      },
      Target: {
        type: "object",
        required: ["type"],
        oneOf: [
          {
            type: "object",
            properties: {
              type: { const: "image" },
              imagePath: { type: "string" },
            },
            required: ["type", "imagePath"],
          },
        ],
      },
    },
  };
}

module.exports = { schemaForAction };
