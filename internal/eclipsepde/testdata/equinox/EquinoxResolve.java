import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.Dictionary;
import java.util.Hashtable;
import java.util.Map;
import java.util.Properties;
import java.util.jar.Attributes;
import java.util.jar.JarFile;
import java.util.jar.Manifest;

import org.eclipse.osgi.service.resolver.BundleDescription;
import org.eclipse.osgi.service.resolver.ExportPackageDescription;
import org.eclipse.osgi.service.resolver.ResolverError;
import org.eclipse.osgi.service.resolver.State;
import org.eclipse.osgi.service.resolver.StateObjectFactory;

/**
 * Resolves bundles with the Equinox State API, the resolver PDE itself uses for
 * the target platform (adOmnia differential test, not shipped).
 *
 * Usage: EquinoxResolve <osgi.jar> <execution environment> <mode> <bundle location>...
 * mode is "development" (what PDE sets) or "production".
 *
 * Output, one line per fact, tab separated:
 *   B location symbolicName version resolved
 *   E location error
 *   W location Import-Package package exporterLocation
 *   W location Require-Bundle bundle supplierLocation
 *   W location Fragment-Host bundle hostLocation
 */
public final class EquinoxResolve {
    public static void main(String[] args) throws Exception {
        String osgiJar = args[0];
        String environment = args[1];
        String mode = args[2];
        StateObjectFactory factory = StateObjectFactory.defaultFactory;
        State state = factory.createState(true);

        Properties platform = new Properties();
        platform.putAll(profile(osgiJar, environment));
        platform.put("osgi.os", "linux");
        platform.put("osgi.ws", "gtk");
        platform.put("osgi.arch", "x86_64");
        platform.put("osgi.nl", "en_US");
        platform.put("osgi.resolverMode", mode);
        state.setPlatformProperties(platform);

        long id = 0;
        for (int i = 3; i < args.length; i++) {
            Dictionary<String, String> headers = manifest(new File(args[i]));
            BundleDescription description = factory.createBundleDescription(state, headers, args[i], id++);
            state.addBundle(description);
        }
        state.resolve(false);

        for (BundleDescription bundle : state.getBundles()) {
            String location = bundle.getLocation();
            System.out.println("B\t" + location + "\t" + bundle.getSymbolicName() + "\t" + bundle.getVersion() + "\t" + bundle.isResolved());
            for (ResolverError error : state.getResolverErrors(bundle)) {
                System.out.println("E\t" + location + "\t" + error.toString().replace('\n', ' ').replace('\t', ' '));
            }
            if (!bundle.isResolved()) {
                continue;
            }
            for (ExportPackageDescription imported : bundle.getResolvedImports()) {
                System.out.println("W\t" + location + "\tImport-Package\t" + imported.getName() + "\t" + imported.getExporter().getLocation());
            }
            for (BundleDescription required : bundle.getResolvedRequires()) {
                System.out.println("W\t" + location + "\tRequire-Bundle\t" + required.getSymbolicName() + "\t" + required.getLocation());
            }
            if (bundle.getHost() != null && bundle.getHost().getSupplier() != null) {
                BundleDescription host = (BundleDescription) bundle.getHost().getSupplier();
                System.out.println("W\t" + location + "\tFragment-Host\t" + host.getSymbolicName() + "\t" + host.getLocation());
            }
        }
    }

    /** The JRE profile shipped in org.eclipse.osgi: system packages and execution environments. */
    private static Properties profile(String osgiJar, String environment) throws Exception {
        Properties properties = new Properties();
        JarFile jar = new JarFile(osgiJar);
        try {
            InputStream in = jar.getInputStream(jar.getEntry(environment + ".profile"));
            properties.load(in);
            in.close();
        } finally {
            jar.close();
        }
        return properties;
    }

    private static Dictionary<String, String> manifest(File location) throws Exception {
        Manifest manifest;
        if (location.isDirectory()) {
            InputStream in = new FileInputStream(new File(location, "META-INF/MANIFEST.MF"));
            try {
                manifest = new Manifest(in);
            } finally {
                in.close();
            }
        } else {
            JarFile jar = new JarFile(location);
            try {
                manifest = jar.getManifest();
            } finally {
                jar.close();
            }
        }
        Hashtable<String, String> headers = new Hashtable<String, String>();
        for (Map.Entry<Object, Object> entry : manifest.getMainAttributes().entrySet()) {
            headers.put(((Attributes.Name) entry.getKey()).toString(), entry.getValue().toString());
        }
        return headers;
    }
}
