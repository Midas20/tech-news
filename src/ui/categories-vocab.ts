// The vocabulary's category ids, as a set, for validating a query parameter.
//
// Imported from vocab/ rather than from the registry page: filters.ts is loaded
// by everything that parses a URL, and routing it through a page module put
// filters -> stacks -> nav -> filters in a cycle that left STREAMS undefined at
// import time.
import { CATEGORIES } from '../vocab/categories.ts';

export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
