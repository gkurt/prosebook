/**
 * `prosebook/vue`: the catalog in Vue components.
 *
 * `useCopy()` reads through a ref the copy bumps on every change, so a template or `computed` that
 * reads a message runs again when the locale switches, with nothing to watch by hand. `rich` returns a
 * `VNode`, which a render function returns as it is and a template renders with
 * `<component :is="...">`; `<Text>` renders one in a template, its tags from slots.
 */
import {
  computed,
  defineComponent,
  Fragment,
  h,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  type App,
  type ComputedRef,
  type InjectionKey,
  type Plugin,
  type SetupContext,
  type Slot,
  type VNode,
  type VNodeChild,
} from 'vue';

import { bindCopy, type BoundCopy, type LooseTextProps } from '#src/runtime/bind.ts';
import type { Copy } from '#src/runtime/copy.ts';
import type { MessageKey, RegisteredLocale, TagFn } from '#src/runtime/types.ts';

/** `Copy`, with `rich` returning a `VNode`, whose reads re-render what calls them. */
export type VueCopy = BoundCopy<VNodeChild, VNode>;

type Tags = { readonly [tag: string]: TagFn<VNodeChild> };

export interface CopyOptions {
  /** Tag renderers every rich read gets, beside the copy's own: `link: (chunks) => h('a', { href }, chunks)`. */
  tags?: Tags;
}

const KEY: InjectionKey<VueCopy> = Symbol('prosebook');

/** The reader and what stops it following the copy. */
function bound(copy: Copy, tags: Tags = {}): [VueCopy, () => void] {
  const version = shallowRef(copy.version);
  const stop = copy.subscribe(() => {
    version.value = copy.version;
  });
  const reader = bindCopy<VNodeChild, VNode>(copy, tags, {
    track: () => void version.value,
    whole: (parts) => h(Fragment, null, parts as VNodeChild[]),
  });
  return [reader, stop];
}

/** The copy for the whole app: `app.use(copyPlugin(copy, { tags }))`. */
export function copyPlugin(copy: Copy, options: CopyOptions = {}): Plugin {
  return {
    install(app: App) {
      const [reader, stop] = bound(copy, options.tags);
      app.provide(KEY, reader);
      app.onUnmount(stop);
    },
  };
}

/** The copy for this component and those under it, in place of the app's. Call it in `setup`. */
export function provideCopy(copy: Copy, options: CopyOptions = {}): VueCopy {
  const [reader, stop] = bound(copy, options.tags);
  provide(KEY, reader);
  onScopeDispose(stop);
  return reader;
}

/** The catalog, in the current locale. A template or `computed` reading it runs again when the locale changes, or in dev the catalog. */
export function useCopy(): VueCopy {
  const reader = inject(KEY, null);
  if (reader === null) throw new Error('prosebook: useCopy() needs copyPlugin(copy) installed, or provideCopy(copy) above it');
  return reader;
}

/** The current locale, as a ref. */
export function useLocale(): ComputedRef<RegisteredLocale> {
  const reader = useCopy();
  return computed(() => reader.locale);
}

/** A slot per tag: each gets what the tag wraps as `chunks`, a `VNode` to render with `<component :is="chunks" />`. */
export type TextSlots = { [tag: string]: Slot<{ chunks: VNode }> | undefined };

export type TextProps<K extends MessageKey> = LooseTextProps<K, VNodeChild>;

/**
 * A message in a template: `<Text id="cart.items" :values="{ count }" />`. Its tags render through
 * a slot of the same name, a function in `values` or the provider's renderers, in that order.
 *
 * ```vue
 * <Text id="cart.terms">
 *   <template #link="{ chunks }"><a href="/terms"><component :is="chunks" /></a></template>
 * </Text>
 * ```
 */
export const Text = defineComponent(
  (props: { id: string; values?: object }, { slots }: SetupContext) => {
    const copy = useCopy();
    return () => {
      const fromSlots: Record<string, unknown> = {};
      for (const [name, slot] of Object.entries(slots))
        if (slot !== undefined) fromSlots[name] = (chunks: VNodeChild[]) => slot({ chunks: h(Fragment, null, chunks) });
      return copy.rich(props.id as never, { ...fromSlots, ...props.values } as never);
    };
  },
  { name: 'Text', props: ['id', 'values'] },
) as unknown as <K extends MessageKey>(props: TextProps<K>, context: { slots: TextSlots }) => VNode;
