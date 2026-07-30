const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '../skills');
const OUTPUT_FILE = path.join(SKILLS_DIR, 'index.json');

function createSkillIndex(skillsDir = SKILLS_DIR) {
  if (!fs.existsSync(skillsDir)) {
    throw new Error(`Skills directory not found: ${skillsDir}`);
  }

  const files = fs.readdirSync(skillsDir)
    .filter(file => file.endsWith('.json') && file !== 'index.json')
    .sort((left, right) => left.localeCompare(right, 'en'));

  const skills = files.map(file => {
    const filePath = path.join(skillsDir, file);
    const skill = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!skill.id || !skill.name) {
      throw new Error(`${file} must contain non-empty id and name fields`);
    }
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description || '',
      executionMode: skill.executionMode || 'REACTIVE',
      file,
    };
  });

  return { skills };
}

function buildIndex(outputFile = OUTPUT_FILE) {
  const index = createSkillIndex();
  fs.writeFileSync(outputFile, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Successfully built index.json with ${index.skills.length} skills.`);
  return index;
}

if (require.main === module) {
  try {
    buildIndex();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildIndex, createSkillIndex };
