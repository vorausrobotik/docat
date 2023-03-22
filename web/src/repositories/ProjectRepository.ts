import { some } from 'lodash'
import semver from 'semver'
import ProjectDetails from '../models/ProjectDetails'
import { Project } from '../models/ProjectsResponse'
import { ProjectSearchResult, SearchResult, VersionSearchResult } from '../models/SearchResult'

const RESOURCE = 'doc'

function filterHiddenVersions (allProjects: Project[]): Project[] {
  // create deep-copy first
  const projects = JSON.parse(JSON.stringify(allProjects)) as Project[]

  projects.forEach(p => {
    p.versions = p.versions.filter(v => !v.hidden)
  })

  return projects.filter(p => p.versions.length > 0)
}

/**
 * Returns a list of all versions of a project.
 * @param {string} projectName Name of the project
 */
async function getVersions (projectName: string): Promise<ProjectDetails[]> {
  const res = await fetch(`/api/projects/${projectName}?include_hidden=true`)

  if (!res.ok) {
    console.error((await res.json() as { message: string }).message)
    return []
  }

  const json = await res.json() as {
    versions: ProjectDetails[]
  }

  return json.versions
}

/**
 * Returns the latest version of a project.
 * Order of precedence: latest, latest tag, latest version
 * @param versions all versions of a project
 */
function getLatestVersion (versions: ProjectDetails[]): ProjectDetails {
  const latest = versions.find((v) => v.name.includes('latest'))
  if (latest != null) {
    return latest
  }

  const latestTag = versions.find((v) => v.tags.includes('latest'))
  if (latestTag != null) {
    return latestTag
  }

  const sortedVersions = versions
    .sort((a, b) => compareVersions(a, b))

  return sortedVersions[sortedVersions.length - 1]
}

/**
 * Returns a SearchResult object containing all projects and versions that contain the search query in their name or tag
 * @param {Project[]} projects List of all projects
 * @param {string} searchQuery Search query
 * @returns {SearchResult} Search result
 */
function search (projects: Project[], searchQuery: string): SearchResult {
  const searchQueryLower = searchQuery.toLowerCase().trim()

  const projectResults: ProjectSearchResult[] = projects
    .filter((project) =>
      project.name.toLowerCase().includes(searchQueryLower) &&
      some(project.versions, (v) => !v.hidden)
    )
    .map((project) => ({
      name: project.name
    }))

  const versionResults: VersionSearchResult[] = projects
    .map((project) =>
      project.versions
        .filter((version) =>
          version.name.toLowerCase().includes(searchQueryLower) &&
          !version.hidden
        )
        .map((version) => ({
          project: project.name,
          version: version.name
        }))
    )
    .flat()

  const tagResults: VersionSearchResult[] = projects
    .map((project) =>
      project.versions
        .filter((version) => !version.hidden)
        .map((version) =>
          version.tags.filter((tag) =>
            tag.toLowerCase().includes(searchQueryLower)
          )
        )
        .map((version) =>
          version.map((tag) => ({
            project: project.name,
            version: tag
          }))
        )
        .flat()
    )
    .flat()

  return {
    projects: projectResults,
    versions: [...versionResults, ...tagResults]
  }
}

/**
 * Returns the logo URL of a given project
 * @param {string} projectName Name of the project
 */
function getProjectLogoURL (projectName: string): string {
  return `/${RESOURCE}/${projectName}/logo`
}

/**
 * Returns the project documentation URL
 * @param {string} projectName Name of the project
 * @param {string} version Version name
 * @param {string?} docsPath Path to the documentation page
 */
function getProjectDocsURL (projectName: string, version: string, docsPath?: string): string {
  return `/${RESOURCE}/${projectName}/${version}/${docsPath ?? ''}`
}

/**
 * Uploads new project documentation
 * @param {string} projectName Name of the project
 * @param {string} version Name of the version
 * @param {FormData} body Data to upload
 */
async function upload (projectName: string, version: string, body: FormData): Promise<void> {
  const resp = await fetch(`/api/${projectName}/${version}`,
    {
      method: 'POST',
      body
    }
  )

  if (resp.ok) return

  switch (resp.status) {
    case 401:
      throw new Error('Failed to upload documentation: Version already exists')
    case 504:
      throw new Error('Failed to upload documentation: Server unreachable')
    default:
      throw new Error(`Failed to upload documentation: ${(await resp.json() as { message: string }).message}`)
  }
}

/**
 * Claim the project token
 * @param {string} projectName Name of the project
 */
async function claim (projectName: string): Promise<{ token: string }> {
  const resp = await fetch(`/api/${projectName}/claim`)

  if (resp.ok) {
    const json = await resp.json() as { token: string }
    return json
  }

  switch (resp.status) {
    case 504:
      throw new Error('Failed to claim project: Server unreachable')
    default:
      throw new Error(`Failed to claim project: ${(await resp.json() as { message: string }).message}`)
  }
}

/**
 * Deletes existing project documentation
 * @param {string} projectName Name of the project
 * @param {string} version Name of the version
 * @param {string} token Token to authenticate
 */
async function deleteDoc (projectName: string, version: string, token: string): Promise<void> {
  const headers = { 'Docat-Api-Key': token }
  const resp = await fetch(`/api/${projectName}/${version}`,
    {
      method: 'DELETE',
      headers
    }
  )

  if (resp.ok) return

  switch (resp.status) {
    case 401:
      throw new Error('Failed to delete documentation: Invalid token')
    case 504:
      throw new Error('Failed to delete documentation: Server unreachable')
    default:
      throw new Error(`Failed to delete documentation: ${(await resp.json() as { message: string }).message}`)
  }
}

/**
 * Compare two versions according to semantic version (semver library)
 * Will always consider the version latest as higher version
 *
 * @param {Object} versionA first version to compare
 * @param {string} versionA.name version name
 * @param {string[] | undefined} versionA.tags optional tags for this vertion
 *
 * @param {Object} versionB second version to compare
 * @param {string} versionB.name version name
 * @param {string[] | undefined} versionB.tags optional tags for this vertion
 */
function compareVersions (versionA: { name: string, tags?: string[] }, versionB: { name: string, tags?: string[] }): number {
  if ((versionA.tags ?? []).includes('latest')) {
    return 1
  }

  if ((versionB.tags ?? []).includes('latest')) {
    return -1
  }

  const semverA = semver.coerce(versionA.name)
  const semverB = semver.coerce(versionB.name)

  if ((semverA == null) || (semverB == null)) {
    return versionA.name.localeCompare(versionB.name)
  }

  return semver.compare(semverA, semverB)
}

/**
* Returns boolean indicating if the project name is part of the favorites.
* @param {string} projectName name of the project
* @returns {boolean} - true is project is favorite
*/
function isFavorite (projectName: string): boolean {
  return localStorage.getItem(projectName) === 'favorite'
}

/**
   * Sets favorite preference on project
   * @param {string} projectName
   * @param {boolean} shouldBeFavorite
   */
function setFavorite (projectName: string, shouldBeFavorite: boolean): void {
  if (shouldBeFavorite) {
    localStorage.setItem(projectName, 'favorite')
  } else {
    localStorage.removeItem(projectName)
  }
}

const exp = {
  getVersions,
  getLatestVersion,
  filterHiddenVersions,
  search,
  getProjectLogoURL,
  getProjectDocsURL,
  upload,
  claim,
  deleteDoc,
  compareVersions,
  isFavorite,
  setFavorite
}

export default exp
