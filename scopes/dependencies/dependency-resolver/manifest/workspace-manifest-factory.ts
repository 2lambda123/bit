import { AspectLoaderMain } from '@teambit/aspect-loader';
import { IssuesClasses } from '@teambit/component-issues';
import { Component } from '@teambit/component';
import componentIdToPackageName from '@teambit/legacy/dist/utils/bit/component-id-to-package-name';
import { DependencyResolver } from '@teambit/legacy/dist/consumer/component/dependencies/dependency-resolver';
import { pickBy, mapValues, uniq, difference } from 'lodash';
import { SemVer } from 'semver';
import pMapSeries from 'p-map-series';
import { snapToSemver } from '@teambit/component-package-version';
import { ComponentDependency, DependencyList, PackageName } from '../dependencies';
import { VariantPolicy, WorkspacePolicy, EnvPolicy } from '../policy';
import { DependencyResolverMain } from '../dependency-resolver.main.runtime';
import { ComponentsManifestsMap } from '../types';
import { ComponentManifest } from './component-manifest';
import { dedupeDependencies, DedupedDependencies, getEmptyDedupedDependencies } from './deduping';
import { ManifestToJsonOptions, ManifestDependenciesObject, DepObjectValue } from './manifest';
import { updateDependencyVersion } from './update-dependency-version';
import { WorkspaceManifest } from './workspace-manifest';

export type DepsFilterFn = (dependencies: DependencyList) => DependencyList;

export type ComponentDependenciesMap = Map<PackageName, ManifestDependenciesObject>;
export interface WorkspaceManifestToJsonOptions extends ManifestToJsonOptions {
  includeDir?: boolean;
}

export type CreateFromComponentsOptions = {
  filterComponentsFromManifests: boolean;
  createManifestForComponentsWithoutDependencies: boolean;
  dedupe?: boolean;
  dependencyFilterFn?: DepsFilterFn;
  resolveVersionsFromDependenciesOnly?: boolean;
  referenceLocalPackages?: boolean;
};

const DEFAULT_CREATE_OPTIONS: CreateFromComponentsOptions = {
  filterComponentsFromManifests: true,
  createManifestForComponentsWithoutDependencies: true,
  dedupe: true,
  resolveVersionsFromDependenciesOnly: false,
};
export class WorkspaceManifestFactory {
  constructor(private dependencyResolver: DependencyResolverMain, private aspectLoader: AspectLoaderMain) {}

  async createFromComponents(
    name: string,
    version: SemVer,
    rootPolicy: WorkspacePolicy,
    rootDir: string,
    components: Component[],
    options: CreateFromComponentsOptions = DEFAULT_CREATE_OPTIONS
  ): Promise<WorkspaceManifest> {
    // Make sure to take other default if passed options with only one option
    const optsWithDefaults = Object.assign({}, DEFAULT_CREATE_OPTIONS, options);
    const hasRootComponents = this.dependencyResolver.hasRootComponents();
    const componentDependenciesMap: ComponentDependenciesMap = await this.buildComponentDependenciesMap(components, {
      filterComponentsFromManifests: optsWithDefaults.filterComponentsFromManifests,
      rootPolicy: optsWithDefaults.resolveVersionsFromDependenciesOnly ? undefined : rootPolicy,
      dependencyFilterFn: optsWithDefaults.dependencyFilterFn,
      referenceLocalPackages: optsWithDefaults.referenceLocalPackages && hasRootComponents,
      rootDependencies: hasRootComponents ? rootPolicy.toManifest().dependencies : undefined,
    });
    let dedupedDependencies = getEmptyDedupedDependencies();
    rootPolicy = rootPolicy.filter((dep) => dep.dependencyId !== '@teambit/legacy');
    if (hasRootComponents) {
      const { rootDependencies } = dedupeDependencies(rootPolicy, componentDependenciesMap);
      // We hoist dependencies in order for the IDE to work.
      // For runtime, the peer dependencies are installed inside:
      // <ws root>/node_module/<comp name>/node_module/<comp name>/node_modules
      dedupedDependencies.rootDependencies = mapValues(
        rootDependencies,
        (deps) => deps && excludeWorkspaceDependencies(deps)
      );
      dedupedDependencies.componentDependenciesMap = componentDependenciesMap;
    } else if (options.dedupe) {
      dedupedDependencies = dedupeDependencies(rootPolicy, componentDependenciesMap);
    } else {
      dedupedDependencies.rootDependencies = rootPolicy.toManifest();
      dedupedDependencies.componentDependenciesMap = componentDependenciesMap;
    }
    const componentsManifestsMap = await this.getComponentsManifests(
      dedupedDependencies,
      components,
      optsWithDefaults.createManifestForComponentsWithoutDependencies
    );
    const envSelfPeers = this.getEnvsSelfPeersPolicy(componentsManifestsMap);
    const workspaceManifest = new WorkspaceManifest(
      name,
      version,
      dedupedDependencies.rootDependencies,
      envSelfPeers,
      rootDir,
      componentsManifestsMap
    );
    return workspaceManifest;
  }

  private getEnvsSelfPeersPolicy(componentsManifestsMap: ComponentsManifestsMap) {
    const foundEnvs: EnvPolicy[] = [];
    for (const component of componentsManifestsMap.values()) {
      foundEnvs.push(component.envPolicy);
    }
    const peersPolicies = foundEnvs.map((policy) => policy.selfPolicy);
    // TODO: At the moment we are just merge everything, so in case of conflicts one will be taken
    // TODO: once we have root for each env, we should know to handle it differently
    const mergedPolicies = VariantPolicy.mergePolices(peersPolicies);
    return mergedPolicies;
  }

  /**
   * Get the components and build a map with the package name (from the component) as key and the dependencies as values
   *
   * @param {Component[]} components
   * @param {boolean} [filterComponentsFromManifests=true] - filter existing components from the dep graphs
   * @returns
   */
  private async buildComponentDependenciesMap(
    components: Component[],
    {
      dependencyFilterFn,
      filterComponentsFromManifests,
      referenceLocalPackages,
      rootDependencies,
      rootPolicy,
    }: {
      dependencyFilterFn?: DepsFilterFn;
      filterComponentsFromManifests?: boolean;
      referenceLocalPackages?: boolean;
      rootDependencies?: Record<string, string>;
      rootPolicy?: WorkspacePolicy;
    }
  ): Promise<ComponentDependenciesMap> {
    const buildResultsP = components.map(async (component) => {
      const packageName = componentIdToPackageName(component.state._consumer);
      let depList = await this.dependencyResolver.getDependencies(component, { includeHidden: true });
      const additionalDeps = {};
      if (referenceLocalPackages) {
        const coreAspectIds = this.aspectLoader.getCoreAspectIds();
        for (const comp of depList.toTypeArray('component') as ComponentDependency[]) {
          const [compIdWithoutVersion] = comp.id.split('@');
          if (
            !comp.isExtension &&
            !coreAspectIds.includes(compIdWithoutVersion) &&
            components.some((c) => c.id.isEqual(comp.componentId))
          ) {
            const pkgName = comp.getPackageName();
            if (pkgName !== '@teambit/harmony') {
              additionalDeps[pkgName] = `workspace:*`;
            }
          }
        }
      }
      const depManifestBeforeFiltering = depList.toDependenciesManifest();

      if (filterComponentsFromManifests ?? true) {
        depList = filterComponents(depList, components);
      }
      // Remove bit bin from dep list
      depList = depList.filter((dep) => dep.id !== '@teambit/legacy');
      if (dependencyFilterFn) {
        depList = dependencyFilterFn(depList);
      }
      await this.updateDependenciesVersions(component, rootPolicy, depList);
      const depManifest = depList.toDependenciesManifest();
      const { devMissings, runtimeMissings } = await getMissingPackages(component);
      // Only add missing root deps that are not already in the component manifest
      // We are using depManifestBeforeFiltering to support (rare) cases when a dependency is both:
      // a component in the workspace (bitmap) and a dependency in the workspace.jsonc / package.json
      // this happens for the bit repo itself for the @teambit/component-version component
      // in this case we don't want to add that to the manifest when it's missing, because it will be linked from the
      // workspace
      const unresolvedRuntimeMissingRootDeps = pickBy(rootDependencies, (_version, rootPackageName) => {
        return (
          runtimeMissings.includes(rootPackageName) &&
          !depManifestBeforeFiltering.dependencies[rootPackageName] &&
          !depManifestBeforeFiltering.devDependencies[rootPackageName] &&
          !depManifestBeforeFiltering.peerDependencies[rootPackageName]
        );
      });
      // Only add missing root deps that are not already in the component manifest
      const unresolvedDevMissingRootDeps = pickBy(rootDependencies, (_version, rootPackageName) => {
        return (
          devMissings.includes(rootPackageName) &&
          !depManifestBeforeFiltering.dependencies[rootPackageName] &&
          !depManifestBeforeFiltering.devDependencies[rootPackageName] &&
          !depManifestBeforeFiltering.peerDependencies[rootPackageName]
        );
      });
      depManifest.dependencies = {
        ...unresolvedRuntimeMissingRootDeps,
        ...additionalDeps,
        ...depManifest.dependencies,
      };

      depManifest.devDependencies = {
        ...unresolvedDevMissingRootDeps,
        ...depManifest.devDependencies,
      };

      return { packageName, depManifest };
    });
    const result: ComponentDependenciesMap = new Map();

    if (buildResultsP.length) {
      const results = await Promise.all(buildResultsP);
      results.forEach((currResult) => {
        result.set(currResult.packageName, currResult.depManifest);
      });
    }

    return result;
  }

  private async updateDependenciesVersions(
    component: Component,
    rootPolicy: WorkspacePolicy | undefined,
    dependencyList: DependencyList
  ): Promise<void> {
    // If root policy is not passed, it means that installation happens in a capsule
    // and we only resolve versions from the dependencies, not any policies.
    const mergedPolicies = rootPolicy && (await this.dependencyResolver.getPolicy(component));
    dependencyList.forEach((dep) => {
      updateDependencyVersion(dep, rootPolicy, mergedPolicies);
    });
  }

  /**
   * Get the components manifests based on the calculated dedupedDependencies
   *
   * @param {DedupedDependencies} dedupedDependencies
   * @param {Component[]} components
   * @returns {ComponentsManifestsMap}
   */
  async getComponentsManifests(
    dedupedDependencies: DedupedDependencies,
    components: Component[],
    createManifestForComponentsWithoutDependencies = true
  ): Promise<ComponentsManifestsMap> {
    const componentsManifests: ComponentsManifestsMap = new Map();
    // don't use Promise.all, along the road this code might import an env from a remote, which can't be done in parallel.
    // otherwise, it may import the same component multiple times, and if fails, the ref (remote-lane) files may be corrupted.
    await pMapSeries(components, async (component) => {
      const packageName = componentIdToPackageName(component.state._consumer);
      if (
        dedupedDependencies.componentDependenciesMap.has(packageName) ||
        createManifestForComponentsWithoutDependencies
      ) {
        const blankDependencies: ManifestDependenciesObject = {
          dependencies: {},
          devDependencies: {},
          peerDependencies: {},
        };
        let dependencies = blankDependencies;
        if (dedupedDependencies.componentDependenciesMap.has(packageName)) {
          dependencies = dedupedDependencies.componentDependenciesMap.get(packageName) as ManifestDependenciesObject;
        }

        const getVersion = (): string => {
          if (!component.id.hasVersion()) return '0.0.1-new';
          return snapToSemver(component.id.version as string);
        };

        const version = getVersion();
        const envPolicy = await this.dependencyResolver.getComponentEnvPolicy(component);
        const manifest = new ComponentManifest(packageName, new SemVer(version), dependencies, component, envPolicy);
        componentsManifests.set(packageName, manifest);
      }
    });
    return componentsManifests;
  }
}

function filterComponents(dependencyList: DependencyList, componentsToFilterOut: Component[]): DependencyList {
  const filtered = dependencyList.filter((dep) => {
    if (!(dep instanceof ComponentDependency)) {
      const depPkgName = dep.getPackageName?.();
      if (!depPkgName) return true;
      // If the package is already in the workspace as a local component,
      // then we don't want to install that package as a dependency to node_modules.
      // Otherwise, it would rewrite the local component inside the root node_modules that is created by bit link.
      return !componentsToFilterOut.some(
        (component) => depPkgName === componentIdToPackageName(component.state._consumer)
      );
    }
    // Remove dependencies which has no version (they are new in the workspace)
    if (!dep.componentId.hasVersion()) return false;
    const existingComponent = componentsToFilterOut.find((component) => {
      // For new components, the component has no version but the dependency id has version 0.0.1
      if (!component.id.hasVersion()) {
        return component.id.toString() === dep.componentId.toString({ ignoreVersion: true });
      }
      // We are checking against both component.id._legacy and component.state._consumer.id
      // Because during tag operation, the component.id._legacy has the current version (before the tag)
      // while the component.state._consumer.id has the upcoming version (the version that will be after the tag)
      // The dependency in some cases is already updated to the upcoming version
      return (
        component.id._legacy.isEqualWithoutVersion(dep.componentId._legacy) ||
        component.state._consumer.id.isEqualWithoutVersion(dep.componentId._legacy)
      );
    });
    if (existingComponent) return false;
    return true;
  });
  return filtered;
}

function excludeWorkspaceDependencies(deps: DepObjectValue): DepObjectValue {
  return pickBy(deps, (versionSpec) => !versionSpec.startsWith('file:') && !versionSpec.startsWith('workspace:'));
}

async function getMissingPackages(component: Component): Promise<{ devMissings: string[]; runtimeMissings: string[] }> {
  const missingPackagesData = component.state.issues.getIssue(IssuesClasses.MissingPackagesDependenciesOnFs)?.data;
  if (!missingPackagesData) return { devMissings: [], runtimeMissings: [] };
  // TODO: this is a hack to get it from the legacy, we should take it from the dev files aspect
  // TODO: the reason we don't is that it will make circular dependency between the dep resolver and the dev files aspect
  const devFiles = await DependencyResolver.getDevFiles(component.state._consumer);
  let devMissings: string[] = [];
  let runtimeMissings: string[] = [];
  Object.entries(missingPackagesData).forEach(([fileName, packages]) => {
    if (devFiles.includes(fileName)) {
      devMissings = uniq([...devMissings, ...packages]);
    } else {
      runtimeMissings = uniq([...runtimeMissings, ...packages]);
    }
  });
  // Remove dev missing which are also runtime missing
  devMissings = difference(devMissings, runtimeMissings);
  return {
    devMissings,
    runtimeMissings,
  };
}
